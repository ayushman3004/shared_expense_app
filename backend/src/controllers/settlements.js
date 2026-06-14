const prisma = require('../services/db');

// Record a settlement (payer records that they paid payee)
async function createSettlement(req, res, next) {
  try {
    const { groupId, fromUserId, toUserId, amount, date, notes } = req.body;

    if (!groupId || !fromUserId || !toUserId || !amount || !date) {
      return res.status(400).json({ error: 'Missing required settlement fields' });
    }

    // Ensure sender and receiver are group members
    const memberships = await prisma.groupMember.findMany({
      where: {
        groupId,
        userId: { in: [fromUserId, toUserId] }
      }
    });

    if (memberships.length !== 2 && fromUserId !== toUserId) {
      return res.status(400).json({ error: 'Sender and receiver must be members of the group' });
    }

    const settlement = await prisma.settlement.create({
      data: {
        groupId,
        fromUserId,
        toUserId,
        amount: parseFloat(amount),
        date: new Date(date),
        notes
      },
      include: {
        fromUser: { select: { id: true, name: true, username: true } },
        toUser: { select: { id: true, name: true, username: true } }
      }
    });

    res.status(201).json(settlement);
  } catch (error) {
    next(error);
  }
}

// Get settlements in a group
async function getSettlementsByGroup(req, res, next) {
  try {
    const { groupId } = req.query;
    if (!groupId) {
      return res.status(400).json({ error: 'groupId query parameter is required' });
    }

    // Ensure user is in group
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

    const settlements = await prisma.settlement.findMany({
      where: { groupId },
      include: {
        fromUser: { select: { id: true, name: true, username: true } },
        toUser: { select: { id: true, name: true, username: true } }
      },
      orderBy: { date: 'desc' }
    });

    res.json(settlements);
  } catch (error) {
    next(error);
  }
}

// Update a settlement
async function updateSettlement(req, res, next) {
  try {
    const { settlementId } = req.params;
    const { amount, date, notes, fromUserId, toUserId } = req.body;

    const existingSettlement = await prisma.settlement.findUnique({
      where: { id: settlementId }
    });

    if (!existingSettlement) {
      return res.status(404).json({ error: 'Settlement not found' });
    }

    // Verify access
    const membership = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId: existingSettlement.groupId,
          userId: req.user.id
        }
      }
    });

    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updatedSettlement = await prisma.settlement.update({
      where: { id: settlementId },
      data: {
        amount: amount !== undefined ? parseFloat(amount) : existingSettlement.amount,
        date: date ? new Date(date) : existingSettlement.date,
        notes: notes !== undefined ? notes : existingSettlement.notes,
        fromUserId: fromUserId || existingSettlement.fromUserId,
        toUserId: toUserId || existingSettlement.toUserId
      },
      include: {
        fromUser: { select: { id: true, name: true } },
        toUser: { select: { id: true, name: true } }
      }
    });

    res.json(updatedSettlement);
  } catch (error) {
    next(error);
  }
}

// Delete a settlement
async function deleteSettlement(req, res, next) {
  try {
    const { settlementId } = req.params;

    const existingSettlement = await prisma.settlement.findUnique({
      where: { id: settlementId }
    });

    if (!existingSettlement) {
      return res.status(404).json({ error: 'Settlement not found' });
    }

    // Verify access
    const membership = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId: existingSettlement.groupId,
          userId: req.user.id
        }
      }
    });

    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await prisma.settlement.delete({
      where: { id: settlementId }
    });

    res.json({ message: 'Settlement deleted successfully' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createSettlement,
  getSettlementsByGroup,
  updateSettlement,
  deleteSettlement
};
