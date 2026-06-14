const prisma = require('../services/db');

// Helper to round to 2 decimals
function round2(val) {
  return Math.round(Number(val) * 100) / 100;
}

// Helper: Calculate splits in cents and handle rounding drift
function calculateSplitAmounts(totalAmountInr, splitType, splitsInput) {
  const centsTotal = Math.round(Number(totalAmountInr) * 100);
  const n = splitsInput.length;
  if (n === 0) return [];

  const centsShares = new Array(n).fill(0);

  if (splitType === 'EQUAL') {
    const centsPerPerson = Math.floor(centsTotal / n);
    const drift = centsTotal - (centsPerPerson * n);

    for (let i = 0; i < n; i++) {
      centsShares[i] = centsPerPerson;
    }
    // Last person absorbs drift
    centsShares[n - 1] += drift;
  }
  else if (splitType === 'PERCENTAGE') {
    let centsSum = 0;
    for (let i = 0; i < n - 1; i++) {
      const pct = parseFloat(splitsInput[i].rawValue.replace('%', ''));
      centsShares[i] = Math.round(centsTotal * (pct / 100));
      centsSum += centsShares[i];
    }
    // Last person absorbs remainder
    centsShares[n - 1] = centsTotal - centsSum;
  }
  else if (splitType === 'SHARE') {
    const weights = splitsInput.map(s => parseFloat(s.rawValue));
    const totalWeight = weights.reduce((s, w) => s + w, 0);

    if (totalWeight <= 0) {
      throw new Error('Total weights must be greater than 0');
    }

    let centsSum = 0;
    for (let i = 0; i < n - 1; i++) {
      centsShares[i] = Math.round(centsTotal * (weights[i] / totalWeight));
      centsSum += centsShares[i];
    }
    // Last person absorbs remainder
    centsShares[n - 1] = centsTotal - centsSum;
  }
  else if (splitType === 'UNEQUAL') {
    // UNEQUAL amounts are explicitly specified. Sum must match total amount (±0.01 tolerance)
    let centsSum = 0;
    for (let i = 0; i < n; i++) {
      const val = parseFloat(splitsInput[i].rawValue);
      centsShares[i] = Math.round(val * 100);
      centsSum += centsShares[i];
    }

    const diff = centsTotal - centsSum;
    if (Math.abs(diff) > 1) { // more than 1 paise discrepancy
      throw new Error(`The sum of individual shares (${(centsSum / 100).toFixed(2)}) must equal the total amount (${(centsTotal / 100).toFixed(2)})`);
    }

    // Absorb minor 1-paise rounding discrepancy
    centsShares[n - 1] += diff;
  }

  return centsShares.map(c => c / 100);
}

// Verify that all split users are active members of the group on the expense date
async function validateTemporalMembership(groupId, date, userIds) {
  const expenseDate = new Date(date);

  const memberships = await prisma.groupMember.findMany({
    where: {
      groupId,
      userId: { in: userIds }
    },
    include: { user: true }
  });

  // Check if all requested users are actually group members
  if (memberships.length !== userIds.length) {
    const foundIds = memberships.map(m => m.userId);
    const missingIds = userIds.filter(id => !foundIds.includes(id));
    throw new Error(`Some users are not members of the group: ${missingIds.join(', ')}`);
  }

  // Check temporal validity
  for (const m of memberships) {
    const joined = new Date(m.joinedAt);
    const left = m.leftAt ? new Date(m.leftAt) : null;

    if (expenseDate < joined) {
      throw new Error(`Participant ${m.user.name} had not joined the group yet on ${expenseDate.toISOString().slice(0, 10)} (joined ${joined.toISOString().slice(0, 10)})`);
    }

    if (left && expenseDate > left) {
      throw new Error(`Participant ${m.user.name} had already left the group on ${expenseDate.toISOString().slice(0, 10)} (left ${left.toISOString().slice(0, 10)})`);
    }
  }
}

// Create Expense
async function createExpense(req, res, next) {
  try {
    const {
      groupId,
      description,
      amount,
      currency,
      exchangeRate,
      paidById,
      splitType,
      date,
      notes,
      splits // array of { userId, rawValue }
    } = req.body;

    if (!groupId || !description || !amount || !paidById || !splitType || !date || !splits || splits.length === 0) {
      return res.status(400).json({ error: 'Missing required expense fields' });
    }

    // Determine amountInr
    const rate = currency === 'USD' ? parseFloat(exchangeRate) : 1;
    if (currency === 'USD' && (!exchangeRate || isNaN(rate))) {
      return res.status(400).json({ error: 'USD exchange rate must be specified' });
    }

    const amountInr = round2(parseFloat(amount) * rate);

    // Validate temporal membership
    const splitUserIds = splits.map(s => s.userId);
    // Include the payer in the check to ensure they are also in the group and active on the date
    const checkUserIds = Array.from(new Set([paidById, ...splitUserIds]));
    
    try {
      await validateTemporalMembership(groupId, date, checkUserIds);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // Calculate individual shares
    let calculatedShares;
    try {
      calculatedShares = calculateSplitAmounts(amountInr, splitType, splits);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // Save Expense + Splits in a transaction
    const expense = await prisma.$transaction(async (tx) => {
      const exp = await tx.expense.create({
        data: {
          groupId,
          description,
          amount: parseFloat(amount),
          currency: currency || 'INR',
          exchangeRate: currency === 'USD' ? rate : null,
          amountInr,
          paidById,
          splitType,
          date: new Date(date),
          notes,
          createdById: req.user.id
        }
      });

      const splitsData = splits.map((s, idx) => ({
        expenseId: exp.id,
        userId: s.userId,
        amountInr: calculatedShares[idx],
        rawValue: s.rawValue || 'equal'
      }));

      await tx.expenseSplit.createMany({
        data: splitsData
      });

      return tx.expense.findUnique({
        where: { id: exp.id },
        include: {
          splits: {
            include: {
              user: { select: { id: true, name: true } }
            }
          },
          paidBy: { select: { id: true, name: true } }
        }
      });
    });

    res.status(201).json(expense);
  } catch (error) {
    next(error);
  }
}

// Get group expenses
async function getExpensesByGroup(req, res, next) {
  try {
    const { groupId } = req.query;
    if (!groupId) {
      return res.status(400).json({ error: 'groupId query parameter is required' });
    }

    // Ensure user has access to group
    const membership = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: req.user.id
        }
      }
    });

    if (!membership) {
      return res.status(403).json({ error: 'Access denied to this group' });
    }

    const expenses = await prisma.expense.findMany({
      where: { groupId },
      include: {
        splits: {
          include: {
            user: { select: { id: true, name: true, username: true } }
          }
        },
        paidBy: { select: { id: true, name: true, username: true } }
      },
      orderBy: { date: 'desc' }
    });

    res.json(expenses);
  } catch (error) {
    next(error);
  }
}

// Update Expense
async function updateExpense(req, res, next) {
  try {
    const { expenseId } = req.params;
    const {
      description,
      amount,
      currency,
      exchangeRate,
      paidById,
      splitType,
      date,
      notes,
      splits
    } = req.body;

    const existingExpense = await prisma.expense.findUnique({
      where: { id: expenseId },
      include: { splits: true }
    });

    if (!existingExpense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    // Ensure requester has admin role or is creator
    const membership = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId: existingExpense.groupId,
          userId: req.user.id
        }
      }
    });

    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const activeDate = date || existingExpense.date;
    const activePayerId = paidById || existingExpense.paidById;
    const activeSplitType = splitType || existingExpense.splitType;
    const activeAmount = amount !== undefined ? parseFloat(amount) : Number(existingExpense.amount);
    const activeCurrency = currency || existingExpense.currency;
    
    let rate = 1;
    if (activeCurrency === 'USD') {
      rate = exchangeRate !== undefined ? parseFloat(exchangeRate) : Number(existingExpense.exchangeRate);
    }
    const amountInr = round2(activeAmount * rate);

    let finalSplits = existingExpense.splits.map(s => ({ userId: s.userId, rawValue: s.rawValue }));
    if (splits && splits.length > 0) {
      finalSplits = splits;
    }

    // Validate temporal membership
    const splitUserIds = finalSplits.map(s => s.userId);
    const checkUserIds = Array.from(new Set([activePayerId, ...splitUserIds]));

    try {
      await validateTemporalMembership(existingExpense.groupId, activeDate, checkUserIds);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // Recompute splits
    let calculatedShares;
    try {
      calculatedShares = calculateSplitAmounts(amountInr, activeSplitType, finalSplits);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // Perform update transaction
    const updatedExpense = await prisma.$transaction(async (tx) => {
      // 1. Update expense metadata
      const exp = await tx.expense.update({
        where: { id: expenseId },
        data: {
          description: description || existingExpense.description,
          amount: activeAmount,
          currency: activeCurrency,
          exchangeRate: activeCurrency === 'USD' ? rate : null,
          amountInr,
          paidById: activePayerId,
          splitType: activeSplitType,
          date: new Date(activeDate),
          notes: notes !== undefined ? notes : existingExpense.notes
        }
      });

      // 2. Clear old splits
      await tx.expenseSplit.deleteMany({
        where: { expenseId }
      });

      // 3. Create new splits
      const splitsData = finalSplits.map((s, idx) => ({
        expenseId,
        userId: s.userId,
        amountInr: calculatedShares[idx],
        rawValue: s.rawValue || 'equal'
      }));

      await tx.expenseSplit.createMany({
        data: splitsData
      });

      return tx.expense.findUnique({
        where: { id: expenseId },
        include: {
          splits: {
            include: {
              user: { select: { id: true, name: true } }
            }
          },
          paidBy: { select: { id: true, name: true } }
        }
      });
    });

    res.json(updatedExpense);
  } catch (error) {
    next(error);
  }
}

// Delete Expense
async function deleteExpense(req, res, next) {
  try {
    const { expenseId } = req.params;

    const existingExpense = await prisma.expense.findUnique({
      where: { id: expenseId }
    });

    if (!existingExpense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    // Verify membership
    const membership = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId: existingExpense.groupId,
          userId: req.user.id
        }
      }
    });

    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await prisma.expense.delete({
      where: { id: expenseId }
    });

    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createExpense,
  getExpensesByGroup,
  updateExpense,
  deleteExpense
};
