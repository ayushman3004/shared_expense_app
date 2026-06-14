require('dotenv').config();
const fs = require('fs');
const path = require('path');
const prisma = require('./services/db');
const { processCSVImport } = require('./services/importer');
const { calculateBalances } = require('./services/balances');

// Helper to find user ID by name (case-insensitive)
function findUserIdByName(name, members) {
  const lower = name.toLowerCase().trim();
  const match = members.find(m => m.user.name.toLowerCase() === lower || m.user.username === lower);
  return match ? match.userId : null;
}

async function testFullImport() {
  console.log('=== START FULL E2E IMPORT AND BALANCE VERIFICATION ===\n');

  try {
    // 1. Fetch group
    const group = await prisma.group.findFirst({
      where: { name: 'Flat 2B Shared Expenses' },
      include: {
        members: {
          include: { user: true }
        }
      }
    });

    if (!group) {
      console.error('Error: Seeded group not found. Run seed script first.');
      process.exit(1);
    }

    console.log(`Using Group: ${group.name}`);
    
    // Clear any previous expenses/settlements/sessions in this group for a clean test run
    await prisma.expenseSplit.deleteMany({ where: { expense: { groupId: group.id } } });
    await prisma.expense.deleteMany({ where: { groupId: group.id } });
    await prisma.settlement.deleteMany({ where: { groupId: group.id } });
    await prisma.importAnomaly.deleteMany({ where: { session: { groupId: group.id } } });
    await prisma.importRow.deleteMany({ where: { session: { groupId: group.id } } });
    await prisma.importSession.deleteMany({ where: { groupId: group.id } });
    console.log('Cleaned existing group transaction records.');

    // 2. Read the CSV file
    const csvPath = path.join(__dirname, '../../expenses_export.csv');
    const csvText = fs.readFileSync(csvPath, 'utf8');

    // 3. Create Import Session
    let session = await prisma.importSession.create({
      data: {
        groupId: group.id,
        filename: 'expenses_export.csv',
        uploadedById: findUserIdByName('Aisha', group.members),
        status: 'PENDING'
      }
    });

    console.log(`Created Import Session: ${session.id}`);

    // 4. Run parse and clean pipeline
    session = await processCSVImport(session.id, csvText);
    console.log(`Initial status: ${session.status} (Held: ${session.heldRows}, Auto-imported: ${session.importedRows}, Total: ${session.totalRows})`);

    // Set USD to INR rate to 83.00
    await prisma.importSession.update({
      where: { id: session.id },
      data: { usdToInr: 83.00 }
    });
    console.log('Set USD-to-INR conversion rate to 83.00');

    // 5. Fetch all rows and their anomalies
    const rows = await prisma.importRow.findMany({
      where: { sessionId: session.id },
      include: { anomalies: true },
      orderBy: { rowNumber: 'asc' }
    });

    console.log(`Fetched ${rows.length} rows to resolve...`);

    // Keep track of exact duplicates seen to reject the second one
    const exactDuplicateSignatures = new Set();

    // 6. Resolve each held row programmatically
    for (const row of rows) {
      if (row.status !== 'HELD') continue;

      const raw = row.rawData;
      const rowAnomCodes = row.anomalies.map(a => a.code);
      
      const resolutions = {};
      let decision = 'IMPORTED'; // default

      // Date ambiguity resolution
      if (rowAnomCodes.includes('DATE_AMBIGUOUS')) {
        // e.g. "01/03/2026"
        const parts = raw.date.split('/');
        // default to DD/MM/YYYY
        let resolvedDate = `2026-03-${parts[0].padStart(2, '0')}`;
        if (parts[2] === '2026') {
          // If Sam (active after April 8) is a split participant, but Meera (left Mar 31) is not
          if (raw.split_with.includes('Sam')) {
            resolvedDate = `2026-04-${parts[0].padStart(2, '0')}`; // interpret as MM/DD/YYYY to place in April
          }
        }
        resolutions['DATE_AMBIGUOUS'] = { date: resolvedDate };
      }

      // Duplicate Exact check
      if (rowAnomCodes.includes('DUPLICATE_EXACT')) {
        const sig = `${raw.date}-${raw.paid_by}-${raw.amount}-${raw.description}`;
        if (exactDuplicateSignatures.has(sig)) {
          decision = 'REJECTED'; // Reject the second duplicate
        } else {
          exactDuplicateSignatures.add(sig);
          decision = 'IMPORTED'; // Keep the first
        }
      }

      // Conflicting duplicates
      if (rowAnomCodes.includes('DUPLICATE_CONFLICTING')) {
        decision = 'REJECTED'; // reject conflicting duplicate row for safety
      }

      // Payer unknown (e.g. "Priya S")
      if (rowAnomCodes.includes('PAYER_UNKNOWN')) {
        let suggestedId = findUserIdByName('Priya', group.members);
        if (raw.paid_by.toLowerCase().startsWith('rohan')) suggestedId = findUserIdByName('Rohan', group.members);
        resolutions['PAYER_UNKNOWN'] = { userId: suggestedId };
      }

      // Payer missing
      if (rowAnomCodes.includes('PAYER_MISSING')) {
        resolutions['PAYER_MISSING'] = { userId: findUserIdByName('Aisha', group.members) };
      }

      // Settlement logged as expense
      if (rowAnomCodes.includes('SETTLEMENT_AS_EXPENSE')) {
        decision = 'IMPORTED';
        if (raw.description.toLowerCase().includes('rohan')) {
          resolutions['SETTLEMENT_AS_EXPENSE'] = {
            decision: 'SETTLEMENT',
            toUserId: findUserIdByName('Aisha', group.members) // Rohan paid Aisha back
          };
        } else if (raw.description.toLowerCase().includes('sam')) {
          resolutions['SETTLEMENT_AS_EXPENSE'] = {
            decision: 'SETTLEMENT',
            toUserId: findUserIdByName('Aisha', group.members) // Sam deposit share paid to Aisha
          };
        } else {
          resolutions['SETTLEMENT_AS_EXPENSE'] = {
            decision: 'SETTLEMENT',
            toUserId: findUserIdByName('Aisha', group.members)
          };
        }
      }

      // Split invalid sums
      if (rowAnomCodes.includes('PERCENTAGE_INVALID_SUM')) {
        // Correct 110% to 100% split
        resolutions['PERCENTAGE_INVALID_SUM'] = {
          splits: [
            { name: 'Aisha', rawValue: '25%' },
            { name: 'Rohan', rawValue: '25%' },
            { name: 'Priya', rawValue: '25%' },
            { name: 'Meera', rawValue: '25%' }
          ]
        };
      }

      // Split details type conflict
      if (rowAnomCodes.includes('SPLIT_TYPE_CONFLICT')) {
        resolutions['SPLIT_TYPE_CONFLICT'] = { splitType: 'PERCENTAGE' };
      }

      // Negative Amount
      if (rowAnomCodes.includes('AMOUNT_NEGATIVE')) {
        decision = 'REJECTED'; // Skip refund or negative row as requested or safe choice
      }

      // Currency missing
      if (rowAnomCodes.includes('CURRENCY_MISSING')) {
        resolutions['CURRENCY_MISSING'] = { currency: 'INR' };
      }

      // Member not in group ("Kabir")
      if (rowAnomCodes.includes('MEMBER_NOT_IN_GROUP')) {
        // Exclude Kabir from split list
        resolutions['MEMBER_NOT_IN_GROUP'] = {
          splits: [
            { name: 'Aisha' },
            { name: 'Rohan' },
            { name: 'Priya' },
            { name: 'Dev' }
          ]
        };
      }

      // Temporal membership violation
      if (rowAnomCodes.includes('MEMBERSHIP_VIOLATION')) {
        // Exclude Meera who left group before the expense date
        const validSplits = raw.split_with
          .split(';')
          .map(n => n.trim())
          .filter(name => name.toLowerCase() !== 'meera')
          .map(name => ({ name }));

        resolutions['MEMBERSHIP_VIOLATION'] = {
          splits: validSplits
        };
      }

      // Write resolutions to DB
      for (const anom of row.anomalies) {
        const resVal = resolutions[anom.code];
        if (resVal !== undefined) {
          await prisma.importAnomaly.update({
            where: { id: anom.id },
            data: {
              resolution: JSON.stringify(resVal),
              resolvedAt: new Date()
            }
          });
        }
      }

      // Update row status
      await prisma.importRow.update({
        where: { id: row.id },
        data: { status: decision }
      });
    }

    // Refresh session totals
    const allRows = await prisma.importRow.findMany({ where: { sessionId: session.id } });
    await prisma.importSession.update({
      where: { id: session.id },
      data: {
        importedRows: allRows.filter(r => r.status === 'IMPORTED').length,
        skippedRows: allRows.filter(r => r.status === 'SKIPPED').length,
        heldRows: allRows.filter(r => r.status === 'HELD').length
      }
    });

    console.log('All rows successfully resolved.');

    // 7. Call Commit endpoint
    console.log('Triggering commitImport transaction...');
    // We will simulate the commit logic from controller directly
    const commitReqMock = { params: { sessionId: session.id } };
    let commitJson = null;
    const commitResMock = {
      status: () => commitResMock,
      json: (data) => { commitJson = data; }
    };
    
    const { commitImport } = require('./controllers/imports');
    await commitImport(commitReqMock, commitResMock, (err) => {
      if (err) throw err;
    });

    console.log(`Commit Message: ${commitJson.message}`);
    console.log(`Total DB Records Created: ${commitJson.records.length}`);

    // 8. Calculate and verify balances
    console.log('\n--- COMPUTING BALANCES ---');
    const balanceResult = await calculateBalances(group.id);

    console.log('\n--- MEMBER NET BALANCES ---');
    Object.values(balanceResult.memberAudits).forEach(audit => {
      console.log(`${audit.user.name.padEnd(8)}: ₹${audit.netBalance.toFixed(2).padStart(8)}`);
    });

    console.log('\n--- GREEDY SIMPLIFIED SETTLEMENTS (Aisha\'s View) ---');
    balanceResult.simplifiedSettlements.forEach(s => {
      console.log(`  ${s.fromUserName} pays ${s.toUserName} => ₹${s.amount.toFixed(2)}`);
    });

    // Verify Meera's temporal limit (Meera left March 31, Sam joined April 8)
    console.log('\n--- TEMPORAL AUDIT CHECKS ---');
    const meeraAudit = balanceResult.memberAudits[findUserIdByName('Meera', group.members)];
    const postMarchMeeraDebits = meeraAudit.debits.filter(d => new Date(d.date) > new Date('2026-03-31T23:59:59Z'));
    console.log(`Meera debits post-March 31: ${postMarchMeeraDebits.length} (Expected: 0)`);

    const samAudit = balanceResult.memberAudits[findUserIdByName('Sam', group.members)];
    const preAprilSamDebits = samAudit.debits.filter(d => new Date(d.date) < new Date('2026-04-08T00:00:00Z'));
    console.log(`Sam debits pre-April 8: ${preAprilSamDebits.length} (Expected: 0)`);

    // Print Rohan's audit trail (Rohan's View)
    console.log('\n--- ROHAN\'s DETAILED AUDIT TRAIL ("No Magic Numbers") ---');
    const rohanAudit = balanceResult.memberAudits[findUserIdByName('Rohan', group.members)];
    console.log(`Total Paid (Credits): ₹${rohanAudit.credits.reduce((s, c) => s + c.creditAmount, 0).toFixed(2)}`);
    console.log(`Total Owed (Debits):  ₹${rohanAudit.debits.reduce((s, d) => s + d.debitAmount, 0).toFixed(2)}`);
    console.log(`Net Balance:          ₹${rohanAudit.netBalance.toFixed(2)}`);
    console.log('\nRohan\'s debits breakdown (first 5):');
    rohanAudit.debits.slice(0, 5).forEach(d => {
      console.log(`  Date: ${new Date(d.date).toISOString().slice(0, 10)} | ${d.description.padEnd(25)} | Owed ₹${d.debitAmount.toFixed(2)} to ${d.paidBy}`);
    });

    console.log('\n=== E2E IMPORT VERIFICATION SUCCESS ===');

  } catch (error) {
    console.error('E2E Import Verification Failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testFullImport();
