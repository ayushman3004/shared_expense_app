const prisma = require('./db');

// Helper to convert Prisma Decimal to float and round to 2 decimal places
function round2(val) {
  if (val === null || val === undefined) return 0;
  return Math.round(Number(val) * 100) / 100;
}

async function calculateBalances(groupId) {
  // 1. Fetch group members
  const members = await prisma.groupMember.findMany({
    where: { groupId },
    include: { user: true }
  });

  // 2. Fetch all group expenses with splits
  const expenses = await prisma.expense.findMany({
    where: { groupId },
    include: {
      splits: true,
      paidBy: true
    }
  });

  // 3. Fetch all group settlements
  const settlements = await prisma.settlement.findMany({
    where: { groupId },
    include: {
      fromUser: true,
      toUser: true
    }
  });

  // Initialize net balances and audit trails for each member
  const netBalances = {};
  const audits = {};

  for (const m of members) {
    const userId = m.userId;
    netBalances[userId] = 0; // in cents
    audits[userId] = {
      user: {
        id: userId,
        name: m.user.name,
        username: m.user.username
      },
      joinedAt: m.joinedAt,
      leftAt: m.leftAt,
      credits: [],    // expenses they paid
      debits: [],     // splits they owe to others
      settlementsSent: [],
      settlementsReceived: [],
      netBalance: 0
    };
  }

  // 4. Process Expenses
  for (const exp of expenses) {
    const paidById = exp.paidById;
    const amountCents = Math.round(Number(exp.amountInr) * 100);

    // Credit the payer (if they are in the group)
    if (audits[paidById]) {
      netBalances[paidById] += amountCents;
      audits[paidById].credits.push({
        expenseId: exp.id,
        description: exp.description,
        date: exp.date,
        totalAmount: round2(exp.amountInr),
        creditAmount: round2(exp.amountInr)
      });
    }

    // Debit each participant
    for (const split of exp.splits) {
      const splitUserId = split.userId;
      const splitAmountCents = Math.round(Number(split.amountInr) * 100);

      if (audits[splitUserId]) {
        netBalances[splitUserId] -= splitAmountCents;
        audits[splitUserId].debits.push({
          expenseId: exp.id,
          description: exp.description,
          date: exp.date,
          totalAmount: round2(exp.amountInr),
          paidBy: exp.paidBy.name,
          paidById: exp.paidById,
          debitAmount: round2(split.amountInr)
        });
      }
    }
  }

  // 5. Process Settlements
  for (const set of settlements) {
    const fromId = set.fromUserId;
    const toId = set.toUserId;
    const setAmountCents = Math.round(Number(set.amount) * 100);

    // Sender gets +balance (reduces debt)
    if (audits[fromId]) {
      netBalances[fromId] += setAmountCents;
      audits[fromId].settlementsSent.push({
        settlementId: set.id,
        date: set.date,
        recipient: set.toUser.name,
        amount: round2(set.amount),
        notes: set.notes
      });
    }

    // Recipient gets -balance (reduces credit)
    if (audits[toId]) {
      netBalances[toId] -= setAmountCents;
      audits[toId].settlementsReceived.push({
        settlementId: set.id,
        date: set.date,
        sender: set.fromUser.name,
        amount: round2(set.amount),
        notes: set.notes
      });
    }
  }

  // Save final balances in standard currency units (floats)
  for (const userId in netBalances) {
    audits[userId].netBalance = round2(netBalances[userId] / 100);
  }

  // 6. Simplify Settlements (Aisha's requirement)
  // Extract list of people with net balances
  const participants = Object.values(audits).map(a => ({
    userId: a.user.id,
    name: a.user.name,
    balance: netBalances[a.user.id] // in cents
  }));

  const debtors = participants.filter(p => p.balance < 0).sort((a, b) => a.balance - b.balance); // most negative first
  const creditors = participants.filter(p => p.balance > 0).sort((a, b) => b.balance - a.balance); // most positive first

  const simplifiedSettlements = [];

  let dIdx = 0;
  let cIdx = 0;

  while (dIdx < debtors.length && cIdx < creditors.length) {
    const debtor = debtors[dIdx];
    const creditor = creditors[cIdx];

    const oweAmount = -debtor.balance;
    const creditAmount = creditor.balance;

    const transferAmount = Math.min(oweAmount, creditAmount);

    simplifiedSettlements.push({
      fromUserId: debtor.userId,
      fromUserName: debtor.name,
      toUserId: creditor.userId,
      toUserName: creditor.name,
      amount: round2(transferAmount / 100)
    });

    debtor.balance += transferAmount;
    creditor.balance -= transferAmount;

    if (debtor.balance === 0) dIdx++;
    if (creditor.balance === 0) cIdx++;
  }

  return {
    group: {
      id: groupId,
      members: members.map(m => ({
        id: m.userId,
        name: m.user.name,
        username: m.user.username,
        joinedAt: m.joinedAt,
        leftAt: m.leftAt
      }))
    },
    simplifiedSettlements,
    memberAudits: audits
  };
}

module.exports = {
  calculateBalances
};
