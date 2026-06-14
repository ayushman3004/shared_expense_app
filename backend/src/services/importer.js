const Papa = require('papaparse');
const prisma = require('./db');

// Helper: Levenshtein distance for duplicate description matching
function getLevenshteinDistance(a, b) {
  const tmp = [];
  let i, j;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  for (i = 0; i <= a.length; i++) tmp[i] = [i];
  for (j = 0; j <= b.length; j++) tmp[0][j] = j;
  for (i = 1; i <= a.length; i++) {
    for (j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return tmp[a.length][b.length];
}

function descriptionsAreSimilar(desc1, desc2) {
  const d1 = desc1.toLowerCase().trim();
  const d2 = desc2.toLowerCase().trim();
  if (d1.includes(d2) || d2.includes(d1)) return true;
  
  // Calculate distance relative to length
  const dist = getLevenshteinDistance(d1, d2);
  const maxLen = Math.max(d1.length, d2.length);
  return (dist / maxLen) < 0.4; // 60% similarity
}

// Parse Date
function parseCsvDate(dateStr) {
  if (!dateStr) {
    return {
      date: null,
      anomalies: [{
        code: 'DATE_AMBIGUOUS',
        description: 'Missing date',
        action: 'HELD_FOR_REVIEW'
      }]
    };
  }

  const trimmed = dateStr.trim();

  // 1. ISO format YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { date: new Date(trimmed), anomalies: [] };
  }

  // 2. DD/MM/YYYY or MM/DD/YYYY format
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const part1 = parseInt(slashMatch[1], 10);
    const part2 = parseInt(slashMatch[2], 10);
    const year = parseInt(slashMatch[3], 10);

    // If both could be month numbers (i.e. <= 12)
    if (part1 <= 12 && part2 <= 12) {
      // Ambigous! e.g. "04/05/2026"
      const date = new Date(Date.UTC(year, part2 - 1, part1)); // Default guess (DD/MM/YYYY)
      return {
        date,
        anomalies: [{
          code: 'DATE_AMBIGUOUS',
          description: `Date "${trimmed}" is ambiguous (April 5 or May 4).`,
          action: 'HELD_FOR_REVIEW'
        }]
      };
    } else {
      // Unambiguous DD/MM/YYYY (e.g. 15/03/2026 -> part1=15, part2=3)
      let day, month;
      if (part1 > 12) {
        day = part1;
        month = part2;
      } else {
        // e.g. 03/15/2026
        day = part2;
        month = part1;
      }
      const date = new Date(Date.UTC(year, month - 1, day));
      return {
        date,
        anomalies: [{
          code: 'DATE_FORMAT_INCONSISTENT',
          description: `Date "${trimmed}" parsed as DD/MM/YYYY (${date.toISOString().slice(0, 10)})`,
          action: 'AUTO_FIXED'
        }]
      };
    }
  }

  // 3. Human format like "Mar 14"
  const wordMatch = trimmed.match(/^([A-Za-z]{3,9})\s+(\d{1,2})$/);
  if (wordMatch) {
    const monthStr = wordMatch[1].toLowerCase();
    const day = parseInt(wordMatch[2], 10);
    const months = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
      january: 0, february: 1, march: 2, april: 3, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
    };
    const month = months[monthStr];
    if (month !== undefined) {
      const date = new Date(Date.UTC(2026, month, day)); // Infer year 2026
      return {
        date,
        anomalies: [{
          code: 'DATE_NONSTANDARD',
          description: `Date "${trimmed}" normalized to ${date.toISOString().slice(0, 10)} (year 2026 inferred)`,
          action: 'AUTO_FIXED'
        }]
      };
    }
  }

  return {
    date: null,
    anomalies: [{
      code: 'DATE_AMBIGUOUS',
      description: `Unrecognized date format "${dateStr}"`,
      action: 'HELD_FOR_REVIEW'
    }]
  };
}

// Resolve Payer Names
function resolvePayer(paidByStr, groupMembers) {
  if (!paidByStr || paidByStr.trim() === '') {
    return {
      userId: null,
      name: '',
      anomalies: [{
        code: 'PAYER_MISSING',
        description: 'Payer name is missing.',
        action: 'HELD_FOR_REVIEW'
      }]
    };
  }

  const trimmed = paidByStr.trim();
  const lower = trimmed.toLowerCase();

  // Tier 1: Exact match on User Name or Username
  let match = groupMembers.find(m => m.user.name === trimmed || m.user.username === lower);
  if (match) {
    return { userId: match.userId, name: match.user.name, anomalies: [] };
  }

  // Tier 2: Case-insensitive match
  match = groupMembers.find(m => m.user.name.toLowerCase() === lower || m.user.username === lower);
  if (match) {
    return {
      userId: match.userId,
      name: match.user.name,
      anomalies: [{
        code: 'PAYER_LOWERCASE',
        description: `Payer name "${paidByStr}" normalized to "${match.user.name}" (case corrected)`,
        action: 'AUTO_FIXED'
      }]
    };
  }

  // Tier 3: Cleaned trailing/leading spaces + case match
  if (paidByStr !== trimmed) {
    match = groupMembers.find(m => m.user.name.toLowerCase() === lower || m.user.username === lower);
    if (match) {
      return {
        userId: match.userId,
        name: match.user.name,
        anomalies: [{
          code: 'PAYER_TRAILING_SPACE',
          description: `Payer name "${paidByStr}" trimmed and case-normalized to "${match.user.name}"`,
          action: 'AUTO_FIXED'
        }]
      };
    }
  }

  // Tier 4: First name prefix match (e.g. "Priya S" -> "Priya")
  const firstWord = lower.split(' ')[0];
  match = groupMembers.find(m => m.user.name.toLowerCase() === firstWord || m.user.username === firstWord);
  if (match) {
    return {
      userId: null, // Held for review
      name: trimmed,
      anomalies: [{
        code: 'PAYER_UNKNOWN',
        description: `Payer "${paidByStr}" is unknown. Did you mean "${match.user.name}"?`,
        action: 'HELD_FOR_REVIEW',
        suggestedUserId: match.user.id
      }]
    };
  }

  return {
    userId: null,
    name: trimmed,
    anomalies: [{
      code: 'PAYER_UNKNOWN',
      description: `Unknown user: "${paidByStr}"`,
      action: 'HELD_FOR_REVIEW'
    }]
  };
}

// Clean Amount
function parseAmount(amountStr) {
  if (!amountStr || amountStr.trim() === '') {
    return {
      amount: null,
      anomalies: [{
        code: 'AMOUNT_NEGATIVE',
        description: 'Amount is missing.',
        action: 'HELD_FOR_REVIEW'
      }]
    };
  }

  let raw = amountStr;
  const anomalies = [];

  // Check AMOUNT_SPACES
  if (raw !== raw.trim()) {
    anomalies.push({
      code: 'AMOUNT_SPACES',
      description: `Amount "${amountStr}" contained extra spaces, trimmed.`,
      action: 'AUTO_FIXED'
    });
    raw = raw.trim();
  }

  // Check AMOUNT_COMMA_FORMAT (e.g. "1,200")
  if (raw.includes(',')) {
    anomalies.push({
      code: 'AMOUNT_COMMA_FORMAT',
      description: `Amount "${amountStr}" contained commas, stripped.`,
      action: 'AUTO_FIXED'
    });
    raw = raw.replace(/,/g, '');
  }

  const num = parseFloat(raw);
  if (isNaN(num)) {
    return {
      amount: null,
      anomalies: [{
        code: 'AMOUNT_NEGATIVE',
        description: `Failed to parse amount "${amountStr}"`,
        action: 'HELD_FOR_REVIEW'
      }]
    };
  }

  // Check AMOUNT_ZERO
  if (num === 0) {
    anomalies.push({
      code: 'AMOUNT_ZERO',
      description: 'Zero amount expense skipped.',
      action: 'SKIPPED'
    });
    return { amount: 0, anomalies };
  }

  // Check AMOUNT_NEGATIVE
  if (num < 0) {
    anomalies.push({
      code: 'AMOUNT_NEGATIVE',
      description: `Negative amount "${num}" detected. Is it a refund?`,
      action: 'HELD_FOR_REVIEW'
    });
    return { amount: num, anomalies };
  }

  // Check AMOUNT_EXCESS_PRECISION (more than 2 decimal places)
  const decimalPart = raw.split('.')[1];
  if (decimalPart && decimalPart.length > 2) {
    const rounded = Math.round(num * 100) / 100;
    anomalies.push({
      code: 'AMOUNT_EXCESS_PRECISION',
      description: `Amount ${num} has excess precision. Rounded to ${rounded.toFixed(2)}`,
      action: 'AUTO_FIXED'
    });
    return { amount: rounded, anomalies };
  }

  return { amount: num, anomalies };
}

// Parse custom split details (like Aisha 30%; Rohan 30% or Aisha 1; Rohan 2)
function parseSplitDetails(detailsStr) {
  if (!detailsStr) return [];
  // detailsStr is formatted as "Aisha 30%; Rohan 30%" or "Aisha 1; Rohan 2"
  return detailsStr.split(';').map(item => {
    const parts = item.trim().split(/\s+/);
    if (parts.length < 2) return null;
    const valueStr = parts.pop();
    const name = parts.join(' ');
    let isPercent = false;
    let val = valueStr;
    if (valueStr.endsWith('%')) {
      isPercent = true;
      val = valueStr.slice(0, -1);
    }
    return {
      name: name.trim(),
      value: parseFloat(val),
      isPercent
    };
  }).filter(Boolean);
}

// Full pipeline processing for single import session
async function processCSVImport(sessionId, csvText) {
  const session = await prisma.importSession.findUnique({
    where: { id: sessionId },
    include: {
      group: {
        include: {
          members: {
            include: { user: true }
          }
        }
      }
    }
  });

  if (!session) throw new Error('Import session not found');

  const groupMembers = session.group.members;
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  const csvRows = parsed.data;

  const results = [];
  const allAnomalies = [];

  for (let idx = 0; idx < csvRows.length; idx++) {
    const row = csvRows[idx];
    const rowNumber = idx + 2; // header + 1-indexed

    const rowAnomalies = [];
    
    // 1. Process Date
    const { date, anomalies: dateAnoms } = parseCsvDate(row.date);
    rowAnomalies.push(...dateAnoms);

    // 2. Process Payer
    const { userId: paidById, name: payerName, anomalies: payerAnoms } = resolvePayer(row.paid_by, groupMembers);
    rowAnomalies.push(...payerAnoms);

    // 3. Process Amount
    const { amount, anomalies: amountAnoms } = parseAmount(row.amount);
    rowAnomalies.push(...amountAnoms);

    // 4. Process Currency
    let currency = row.currency ? row.currency.trim().toUpperCase() : '';
    if (currency === '') {
      rowAnomalies.push({
        code: 'CURRENCY_MISSING',
        description: 'Currency field is blank.',
        action: 'HELD_FOR_REVIEW'
      });
    } else if (currency === 'USD') {
      rowAnomalies.push({
        code: 'CURRENCY_USD',
        description: 'Currency is in US Dollars. Needs conversion rate.',
        action: 'HELD_FOR_REVIEW'
      });
    }

    // 5. Check Settlement Pattern
    const isSettlementDesc = row.description && (
      row.description.toLowerCase().includes('paid back') ||
      row.description.toLowerCase().includes('paid') && row.description.toLowerCase().includes('back') ||
      row.description.toLowerCase().includes('deposit share') ||
      row.description.toLowerCase().includes('settle')
    );
    const splitWithList = row.split_with ? row.split_with.split(';').map(n => n.trim()) : [];
    
    if (isSettlementDesc || (splitWithList.length === 1 && !row.split_type)) {
      rowAnomalies.push({
        code: 'SETTLEMENT_AS_EXPENSE',
        description: `Logged row "${row.description}" matches settlement pattern.`,
        action: 'HELD_FOR_REVIEW'
      });
    }

    // 6. Split & Member timelines
    let splitType = row.split_type ? row.split_type.trim().toLowerCase() : 'equal';
    const cleanSplitType = splitType === 'percentage' ? 'PERCENTAGE' :
                          splitType === 'unequal' ? 'UNEQUAL' :
                          splitType === 'share' ? 'SHARE' : 'EQUAL';

    // Verify participants exist in group
    const participantUserIds = [];
    const participantMembers = [];

    for (const pName of splitWithList) {
      if (pName === '') continue;
      const lowerP = pName.toLowerCase();
      const matchMember = groupMembers.find(m => m.user.name.toLowerCase() === lowerP || m.user.username === lowerP);
      if (!matchMember) {
        rowAnomalies.push({
          code: 'MEMBER_NOT_IN_GROUP',
          description: `Participant "${pName}" is not a group member.`,
          action: 'HELD_FOR_REVIEW'
        });
      } else {
        participantUserIds.push(matchMember.userId);
        participantMembers.push(matchMember);

        // Temporal membership violation
        if (date) {
          const joined = matchMember.joinedAt;
          const left = matchMember.leftAt;
          if (date < joined || (left && date > left)) {
            rowAnomalies.push({
              code: 'MEMBERSHIP_VIOLATION',
              description: `Participant "${matchMember.user.name}" was not active on the expense date (${date.toISOString().slice(0, 10)}).`,
              action: 'HELD_FOR_REVIEW'
            });
          }
        }
      }
    }

    // Split details checks
    const details = parseSplitDetails(row.split_details);
    if (cleanSplitType === 'EQUAL' && details.length > 0) {
      rowAnomalies.push({
        code: 'SPLIT_TYPE_CONFLICT',
        description: 'Split type is equal, but split details were specified.',
        action: 'HELD_FOR_REVIEW'
      });
    }

    if (cleanSplitType === 'PERCENTAGE' && details.length > 0) {
      const sum = details.reduce((s, d) => s + d.value, 0);
      if (Math.abs(sum - 100) > 0.01) {
        rowAnomalies.push({
          code: 'PERCENTAGE_INVALID_SUM',
          description: `Split percentages sum to ${sum}% (must equal 100%).`,
          action: 'HELD_FOR_REVIEW'
        });
      }
    }

    // Determine default row status
    let status = 'PENDING';
    const hasHeld = rowAnomalies.some(a => a.action === 'HELD_FOR_REVIEW');
    const hasSkipped = rowAnomalies.some(a => a.action === 'SKIPPED');

    if (hasHeld) {
      status = 'HELD';
    } else if (hasSkipped) {
      status = 'SKIPPED';
    } else {
      status = 'IMPORTED'; // Safe to auto-import (auto-fixes applied)
    }

    results.push({
      rowNumber,
      rawData: row,
      status,
      date,
      paidById,
      amount,
      currency,
      splitType: cleanSplitType,
      splitWithList,
      details,
      description: row.description,
      notes: row.notes,
      anomalies: rowAnomalies
    });
  }

  // 7. Duplicate Checks (Cross-row duplicate checks in this import session)
  for (let i = 0; i < results.length; i++) {
    const r1 = results[i];
    if (!r1.date || !r1.amount) continue;

    for (let j = i + 1; j < results.length; j++) {
      const r2 = results[j];
      if (!r2.date || !r2.amount) continue;

      // Exact Date check
      if (r1.date.getTime() === r2.date.getTime()) {
        const sortedPart1 = [...r1.splitWithList].sort().join(';');
        const sortedPart2 = [...r2.splitWithList].sort().join(';');

        if (sortedPart1 === sortedPart2) {
          // Check DUPLICATE_EXACT
          if (r1.amount === r2.amount && r1.paidById === r2.paidById) {
            r1.status = 'HELD';
            r2.status = 'HELD';

            r1.anomalies.push({
              code: 'DUPLICATE_EXACT',
              description: `Row matches Row ${r2.rowNumber} exactly.`,
              action: 'HELD_FOR_REVIEW'
            });
            r2.anomalies.push({
              code: 'DUPLICATE_EXACT',
              description: `Row matches Row ${r1.rowNumber} exactly.`,
              action: 'HELD_FOR_REVIEW'
            });
          }
          // Check DUPLICATE_CONFLICTING
          else if (descriptionsAreSimilar(r1.description || '', r2.description || '')) {
            r1.status = 'HELD';
            r2.status = 'HELD';

            r1.anomalies.push({
              code: 'DUPLICATE_CONFLICTING',
              description: `Conflict: Similar description to Row ${r2.rowNumber} but different amount/payer.`,
              action: 'HELD_FOR_REVIEW'
            });
            r2.anomalies.push({
              code: 'DUPLICATE_CONFLICTING',
              description: `Conflict: Similar description to Row ${r1.rowNumber} but different amount/payer.`,
              action: 'HELD_FOR_REVIEW'
            });
          }
        }
      }
    }
  }

  // Create db entries for ImportSession, ImportRows, and ImportAnomalies
  let totalRows = results.length;
  let importedRows = results.filter(r => r.status === 'IMPORTED').length;
  let skippedRows = results.filter(r => r.status === 'SKIPPED').length;
  let heldRows = results.filter(r => r.status === 'HELD').length;

  const updatedSession = await prisma.importSession.update({
    where: { id: sessionId },
    data: {
      status: heldRows > 0 ? 'REVIEWING' : 'COMPLETED',
      totalRows,
      importedRows,
      skippedRows,
      heldRows
    }
  });

  for (const r of results) {
    const rowRecord = await prisma.importRow.create({
      data: {
        sessionId,
        rowNumber: r.rowNumber,
        rawData: r.rawData,
        status: r.status
      }
    });

    if (r.anomalies.length > 0) {
      await prisma.importAnomaly.createMany({
        data: r.anomalies.map(anom => ({
          sessionId,
          rowId: rowRecord.id,
          rowNumber: r.rowNumber,
          code: anom.code,
          description: anom.description,
          action: anom.action
        }))
      });
    }
  }

  return updatedSession;
}

module.exports = {
  processCSVImport,
  parseCsvDate,
  resolvePayer,
  parseAmount
};
