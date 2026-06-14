const prisma = require('../services/db');
const { calculateBalances } = require('../services/balances');

// Create a new group
async function createGroup(req, res, next) {
  try {
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    const group = await prisma.group.create({
      data: {
        name,
        description,
        createdById: req.user.id,
        members: {
          create: {
            userId: req.user.id,
            role: 'ADMIN',
            joinedAt: new Date()
          }
        }
      },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, username: true }
            }
          }
        }
      }
    });

    res.status(201).json(group);
  } catch (error) {
    next(error);
  }
}

// Get user's groups
async function getGroups(req, res, next) {
  try {
    const groups = await prisma.group.findMany({
      where: {
        members: {
          some: {
            userId: req.user.id
          }
        }
      },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, username: true }
            }
          }
        }
      }
    });

    res.json(groups);
  } catch (error) {
    next(error);
  }
}

// Get group detail
async function getGroupById(req, res, next) {
  try {
    const { groupId } = req.params;

    const group = await prisma.group.findFirst({
      where: {
        id: groupId,
        members: {
          some: { userId: req.user.id }
        }
      },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, username: true, email: true }
            }
          }
        }
      }
    });

    if (!group) {
      return res.status(404).json({ error: 'Group not found or access denied' });
    }

    res.json(group);
  } catch (error) {
    next(error);
  }
}

// Update group name/description
async function updateGroup(req, res, next) {
  try {
    const { groupId } = req.params;
    const { name, description } = req.body;

    // Check if requester is group admin
    const membership = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: req.user.id
        }
      }
    });

    if (!membership || membership.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only group admins can update group settings' });
    }

    const updatedGroup = await prisma.group.update({
      where: { id: groupId },
      data: { name, description }
    });

    res.json(updatedGroup);
  } catch (error) {
    next(error);
  }
}

// Add member to group
async function addGroupMember(req, res, next) {
  try {
    const { groupId } = req.params;
    const { username, role, joinedAt, leftAt } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    // Check if requester is group admin
    const requesterMembership = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: req.user.id
        }
      }
    });

    if (!requesterMembership || requesterMembership.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only group admins can add members' });
    }

    let userToAdd = await prisma.user.findUnique({
      where: { username: username.toLowerCase().trim() }
    });

    if (!userToAdd) {
      // Auto-create a shadow/temp user so the admin can add anyone on the fly
      const name = username;
      const cleanUsername = username.toLowerCase().trim();
      const email = `${cleanUsername}@temp.spreetail.com`;
      const bcrypt = require('bcryptjs');
      const dummyPasswordHash = await bcrypt.hash('tempPassword123', 10);

      // Check if email already exists
      const existingUserByEmail = await prisma.user.findUnique({
        where: { email }
      });
      if (existingUserByEmail) {
        return res.status(400).json({ error: `Email "${email}" is already in use.` });
      }

      userToAdd = await prisma.user.create({
        data: {
          name,
          username: cleanUsername,
          email,
          passwordHash: dummyPasswordHash
        }
      });
    }

    // Check if already a member
    const existingMembership = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: userToAdd.id
        }
      }
    });

    if (existingMembership) {
      return res.status(400).json({ error: 'User is already a member of this group' });
    }

    const newMembership = await prisma.groupMember.create({
      data: {
        groupId,
        userId: userToAdd.id,
        role: role || 'MEMBER',
        joinedAt: joinedAt ? new Date(joinedAt) : new Date(),
        leftAt: leftAt ? new Date(leftAt) : null
      },
      include: {
        user: {
          select: { id: true, name: true, username: true }
        }
      }
    });

    res.status(201).json(newMembership);
  } catch (error) {
    next(error);
  }
}

// Update membership timelines/role
async function updateGroupMember(req, res, next) {
  try {
    const { groupId, userId } = req.params;
    const { role, joinedAt, leftAt } = req.body;

    // Check if requester is group admin
    const requesterMembership = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: req.user.id
        }
      }
    });

    if (!requesterMembership || requesterMembership.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only group admins can modify memberships' });
    }

    // Verify member exists
    const memberToUpdate = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId
        }
      }
    });

    if (!memberToUpdate) {
      return res.status(404).json({ error: 'Group member not found' });
    }

    const updatedMembership = await prisma.groupMember.update({
      where: {
        groupId_userId: {
          groupId,
          userId
        }
      },
      data: {
        role: role || memberToUpdate.role,
        joinedAt: joinedAt ? new Date(joinedAt) : memberToUpdate.joinedAt,
        leftAt: leftAt !== undefined ? (leftAt ? new Date(leftAt) : null) : memberToUpdate.leftAt
      },
      include: {
        user: {
          select: { id: true, name: true, username: true }
        }
      }
    });

    res.json(updatedMembership);
  } catch (error) {
    next(error);
  }
}

// Delete group member
async function removeGroupMember(req, res, next) {
  try {
    const { groupId, userId } = req.params;

    // Check if requester is group admin
    const requesterMembership = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: req.user.id
        }
      }
    });

    if (!requesterMembership || requesterMembership.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only group admins can remove members' });
    }

    // Check if member has active expense splits or paid expenses
    const hasPaidExpenses = await prisma.expense.findFirst({
      where: { groupId, paidById: userId }
    });

    const hasSplits = await prisma.expenseSplit.findFirst({
      where: {
        userId,
        expense: { groupId }
      }
    });

    const hasSentSettlements = await prisma.settlement.findFirst({
      where: { groupId, fromUserId: userId }
    });

    const hasReceivedSettlements = await prisma.settlement.findFirst({
      where: { groupId, toUserId: userId }
    });

    if (hasPaidExpenses || hasSplits || hasSentSettlements || hasReceivedSettlements) {
      // Cannot delete member because it would corrupt financial history.
      // Enforce setting a leftAt date instead.
      return res.status(400).json({
        error: 'Cannot delete member due to existing financial records. Please set a "Left At" date on their membership to deactivate them instead.'
      });
    }

    await prisma.groupMember.delete({
      where: {
        groupId_userId: {
          groupId,
          userId
        }
      }
    });

    res.json({ message: 'Group member removed successfully' });
  } catch (error) {
    next(error);
  }
}

// Get group balances and simplified settlements
async function getGroupBalances(req, res, next) {
  try {
    const { groupId } = req.params;

    // Verify user is in group
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

    const balances = await calculateBalances(groupId);
    res.json(balances);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createGroup,
  getGroups,
  getGroupById,
  updateGroup,
  addGroupMember,
  updateGroupMember,
  removeGroupMember,
  getGroupBalances
};
