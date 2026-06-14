const prisma = require('../services/db');
const { processCSVImport, parseCsvDate, resolvePayer, parseAmount } = require('../services/importer');

// Helper to round to 2 decimals
function round2(val) {
  return Math.round(Number(val) * 100) / 100;
}

// Start import session (Upload)
async function uploadCSV(req, res, next) {
  try {
    const { groupId } = req.body;
    if (!groupId) {
      return res.status(400).json({ error: 'groupId is required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded' });
    }

    // Check membership
    const membership = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: req.user.id
        }
      }
    });

    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Create a new ImportSession
    const session = await prisma.importSession.create({
      data: {
        groupId,
        filename: req.file.originalname,
        uploadedById: req.user.id,
        status: 'PENDING'
      }
    });

    const csvText = req.file.buffer.toString('utf8');

    // Run import pipeline
    const updatedSession = await processCSVImport(session.id, csvText);

    res.status(201).json(updatedSession);
  } catch (error) {
    next(error);
  }
}

// Get session report
async function getImportReport(req, res, next) {
  try {
    const { sessionId } = req.params;

    const session = await prisma.importSession.findUnique({
      where: { id: sessionId },
      include: {
        rows: {
          include: {
            anomalies: true
          },
          orderBy: { rowNumber: 'asc' }
        }
      }
    });

    if (!session) {
      return res.status(404).json({ error: 'Import session not found' });
    }

    res.json(session);
  } catch (error) {
    next(error);
  }
}

// Set USD exchange rate
async function setExchangeRate(req, res, next) {
  try {
    const { sessionId } = req.params;
    const { usdToInr } = req.body;

    if (!usdToInr || isNaN(parseFloat(usdToInr))) {
      return res.status(400).json({ error: 'Valid exchange rate is required' });
    }

    const session = await prisma.importSession.update({
      where: { id: sessionId },
      data: {
        usdToInr: parseFloat(usdToInr)
      }
    });

    res.json(session);
  } catch (error) {
    next(error);
  }
}

// Resolve a specific row's anomalies
async function resolveRow(req, res, next) {
  try {
    const { sessionId, rowId } = req.params;
    const { resolutions, decision } = req.body; // decision: IMPORTED / REJECTED

    const row = await prisma.importRow.findFirst({
      where: { id: rowId, sessionId },
      include: { anomalies: true }
    });

    if (!row) {
      return res.status(404).json({ error: 'Row not found in this session' });
    }

    // Save resolutions to ImportAnomaly records
    for (const anom of row.anomalies) {
      const resVal = resolutions[anom.code];
      if (resVal !== undefined) {
        await prisma.importAnomaly.update({
          where: { id: anom.id },
          data: {
            resolution: typeof resVal === 'object' ? JSON.stringify(resVal) : String(resVal),
            resolvedAt: new Date()
          }
        });
      }
    }

    // Update row status
    const updatedRow = await prisma.importRow.update({
      where: { id: rowId },
      data: {
        status: decision || 'IMPORTED'
      },
      include: { anomalies: true }
    });

    // Update session statistics
    const allRows = await prisma.importRow.findMany({ where: { sessionId } });
    await prisma.importSession.update({
      where: { id: sessionId },
      data: {
        importedRows: allRows.filter(r => r.status === 'IMPORTED').length,
        skippedRows: allRows.filter(r => r.status === 'SKIPPED').length,
        heldRows: allRows.filter(r => r.status === 'HELD').length
      }
    });

    res.json(updatedRow);
  } catch (error) {
    next(error);
  }
}

// Commit the entire import session atomically
async function commitImport(req, res, next) {
  try {
    const { sessionId } = req.params;

    const session = await prisma.importSession.findUnique({
      where: { id: sessionId },
      include: {
        group: {
          include: {
            members: {
              include: { user: true }
            }
          }
        },
        rows: {
          include: { anomalies: true }
        }
      }
    });

    if (!session) {
      return res.status(404).json({ error: 'Import session not found' });
    }

    // Check if there are any outstanding HELD rows
    const hasHeld = session.rows.some(r => r.status === 'HELD');
    if (hasHeld) {
      return res.status(400).json({ error: 'Cannot commit. There are unresolved anomalies (HELD rows).' });
    }

    const groupMembers = session.group.members;
    const usdRate = session.usdToInr ? Number(session.usdToInr) : null;

    // Run commit in single transaction
    const commitResults = await prisma.$transaction(async (tx) => {
      const importedRecords = [];

      for (const row of session.rows) {
        if (row.status !== 'IMPORTED') continue; // skip REJECTED and SKIPPED

        const raw = row.rawData;

        // Gather resolutions
        const resMap = {};
        for (const anom of row.anomalies) {
          if (anom.resolution) {
            try {
              resMap[anom.code] = JSON.parse(anom.resolution);
            } catch (e) {
              resMap[anom.code] = anom.resolution; // fallback to string
            }
          }
        }

        // 1. Determine Date
        let date = null;
        if (resMap['DATE_AMBIGUOUS'] && resMap['DATE_AMBIGUOUS'].date) {
          date = new Date(resMap['DATE_AMBIGUOUS'].date);
        } else {
          const parsed = parseCsvDate(raw.date);
          date = parsed.date;
        }

        // 2. Determine Payer
        let paidById = null;
        if (resMap['PAYER_UNKNOWN'] && resMap['PAYER_UNKNOWN'].userId) {
          paidById = resMap['PAYER_UNKNOWN'].userId;
        } else if (resMap['PAYER_MISSING'] && resMap['PAYER_MISSING'].userId) {
          paidById = resMap['PAYER_MISSING'].userId;
        } else {
          const resolved = resolvePayer(raw.paid_by, groupMembers);
          paidById = resolved.userId;
        }

        // 3. Determine Amount
        let amount = null;
        const parsedAmt = parseAmount(raw.amount);
        amount = parsedAmt.amount;

        // If negative, is it imported as refund?
        const isRefund = resMap['AMOUNT_NEGATIVE'] && resMap['AMOUNT_NEGATIVE'].decision === 'REFUND';
        if (amount < 0 && !isRefund) {
          continue; // rejected or skipped
        }

        // 4. Determine Currency & Exchange Rate
        let currency = raw.currency ? raw.currency.trim().toUpperCase() : 'INR';
        if (resMap['CURRENCY_MISSING'] && resMap['CURRENCY_MISSING'].currency) {
          currency = resMap['CURRENCY_MISSING'].currency;
        }

        let rate = 1;
        if (currency === 'USD') {
          if (!usdRate) {
            throw new Error(`USD exchange rate is missing for USD row ${row.rowNumber}`);
          }
          rate = usdRate;
        }

        const amountInr = round2(amount * rate);

        // 5. Check if it's imported as a settlement
        const isSettlement = resMap['SETTLEMENT_AS_EXPENSE'] && resMap['SETTLEMENT_AS_EXPENSE'].decision === 'SETTLEMENT';
        
        if (isSettlement) {
          const toUserId = resMap['SETTLEMENT_AS_EXPENSE'].toUserId;
          const setRecord = await tx.settlement.create({
            data: {
              groupId: session.groupId,
              fromUserId: paidById,
              toUserId,
              amount: Math.abs(amountInr), // settlement amount is positive
              date: date || new Date(),
              notes: raw.notes || `Imported settlement from CSV Row ${row.rowNumber}`,
              csvRowNumber: row.rowNumber
            }
          });

          // Link row to settlement
          await tx.importRow.update({
            where: { id: row.id },
            data: { settlementId: setRecord.id }
          });

          importedRecords.push({ type: 'Settlement', id: setRecord.id });
          continue;
        }

        // 6. Handle Expense splits
        let splitType = raw.split_type ? raw.split_type.trim().toLowerCase() : 'equal';
        let cleanSplitType = splitType === 'percentage' ? 'PERCENTAGE' :
                              splitType === 'unequal' ? 'UNEQUAL' :
                              splitType === 'share' ? 'SHARE' : 'EQUAL';

        if (resMap['SPLIT_TYPE_CONFLICT'] && resMap['SPLIT_TYPE_CONFLICT'].splitType) {
          cleanSplitType = resMap['SPLIT_TYPE_CONFLICT'].splitType;
        }

        // Parse participants list
        let splitWithList = raw.split_with ? raw.split_with.split(';').map(n => n.trim()) : [];
        
        // Resolve split list (if modified by resolutions, like membership violation)
        if (resMap['MEMBERSHIP_VIOLATION'] && resMap['MEMBERSHIP_VIOLATION'].splits) {
          splitWithList = resMap['MEMBERSHIP_VIOLATION'].splits.map(s => s.name);
        } else if (resMap['MEMBER_NOT_IN_GROUP'] && resMap['MEMBER_NOT_IN_GROUP'].splits) {
          splitWithList = resMap['MEMBER_NOT_IN_GROUP'].splits.map(s => s.name);
        }

        const resolvedParticipants = [];
        for (const pName of splitWithList) {
          if (pName === '') continue;
          const matchMember = groupMembers.find(m => m.user.name.toLowerCase() === pName.toLowerCase() || m.user.username === pName.toLowerCase());
          if (matchMember) {
            resolvedParticipants.push(matchMember);
          }
        }

        if (resolvedParticipants.length === 0) continue; // skip empty split expenses

        // Retrieve split shares rawValues (percentages, shares, etc.)
        let finalSplitsInput = [];

        if (cleanSplitType === 'EQUAL') {
          finalSplitsInput = resolvedParticipants.map(rp => ({
            userId: rp.userId,
            rawValue: 'equal'
          }));
        } else {
          // Percentages, unequal or shares
          let splitDetailsMap = {};
          
          if (resMap['PERCENTAGE_INVALID_SUM'] && resMap['PERCENTAGE_INVALID_SUM'].splits) {
            resMap['PERCENTAGE_INVALID_SUM'].splits.forEach(s => {
              splitDetailsMap[s.name.toLowerCase()] = s.rawValue;
            });
          } else {
            // Parse from raw split details field
            const parsedDetails = raw.split_details ? raw.split_details.split(';') : [];
            parsedDetails.forEach(item => {
              const parts = item.trim().split(/\s+/);
              if (parts.length >= 2) {
                const valStr = parts.pop();
                const name = parts.join(' ').toLowerCase();
                splitDetailsMap[name] = valStr;
              }
            });
          }

          finalSplitsInput = resolvedParticipants.map(rp => {
            const rawVal = splitDetailsMap[rp.user.name.toLowerCase()] || 
                            splitDetailsMap[rp.user.username.toLowerCase()] || 
                            (cleanSplitType === 'PERCENTAGE' ? '0%' : '0');
            return {
              userId: rp.userId,
              rawValue: rawVal
            };
          });
        }

        // Compute split shares in cents and handle drift
        const centsTotal = Math.round(amountInr * 100);
        const n = finalSplitsInput.length;
        const centsShares = new Array(n).fill(0);

        if (cleanSplitType === 'EQUAL') {
          const share = Math.floor(centsTotal / n);
          centsShares.fill(share);
          centsShares[n - 1] += (centsTotal - (share * n));
        } else if (cleanSplitType === 'PERCENTAGE') {
          let centsSum = 0;
          for (let i = 0; i < n - 1; i++) {
            const pct = parseFloat(finalSplitsInput[i].rawValue.replace('%', ''));
            centsShares[i] = Math.round(centsTotal * (pct / 100));
            centsSum += centsShares[i];
          }
          centsShares[n - 1] = centsTotal - centsSum;
        } else if (cleanSplitType === 'SHARE') {
          const weights = finalSplitsInput.map(s => parseFloat(s.rawValue));
          const totalWeight = weights.reduce((s, w) => s + w, 0);
          let centsSum = 0;
          if (totalWeight > 0) {
            for (let i = 0; i < n - 1; i++) {
              centsShares[i] = Math.round(centsTotal * (weights[i] / totalWeight));
              centsSum += centsShares[i];
            }
            centsShares[n - 1] = centsTotal - centsSum;
          }
        } else if (cleanSplitType === 'UNEQUAL') {
          let centsSum = 0;
          for (let i = 0; i < n; i++) {
            const val = parseFloat(finalSplitsInput[i].rawValue);
            centsShares[i] = Math.round(val * 100);
            centsSum += centsShares[i];
          }
          centsShares[n - 1] += (centsTotal - centsSum); // absorb minor difference
        }

        const calculatedShares = centsShares.map(c => c / 100);

        // Create Expense record
        const expRecord = await tx.expense.create({
          data: {
            groupId: session.groupId,
            description: raw.description || 'CSV Imported Expense',
            amount: parseFloat(amount),
            currency,
            exchangeRate: currency === 'USD' ? rate : null,
            amountInr,
            paidById,
            splitType: cleanSplitType,
            date: date || new Date(),
            notes: raw.notes,
            csvRowNumber: row.rowNumber,
            createdById: session.uploadedById
          }
        });

        // Create Expense splits
        const splitsData = finalSplitsInput.map((s, idx) => ({
          expenseId: expRecord.id,
          userId: s.userId,
          amountInr: calculatedShares[idx],
          rawValue: s.rawValue
        }));

        await tx.expenseSplit.createMany({
          data: splitsData
        });

        // Link row to expense
        await tx.importRow.update({
          where: { id: row.id },
          data: { expenseId: expRecord.id }
        });

        importedRecords.push({ type: 'Expense', id: expRecord.id });
      }

      // Update session status to completed
      await tx.importSession.update({
        where: { id: sessionId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date()
        }
      });

      return importedRecords;
    });

    res.json({
      message: `Import session committed successfully. Imported ${commitResults.length} records.`,
      records: commitResults
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  uploadCSV,
  getImportReport,
  setExchangeRate,
  resolveRow,
  commitImport
};
