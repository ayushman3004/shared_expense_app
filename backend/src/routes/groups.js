const express = require('express');
const {
  createGroup,
  getGroups,
  getGroupById,
  updateGroup,
  addGroupMember,
  updateGroupMember,
  removeGroupMember,
  getGroupBalances
} = require('../controllers/groups');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

router.use(authenticate);

router.post('/', createGroup);
router.get('/', getGroups);
router.get('/:groupId', getGroupById);
router.get('/:groupId/balances', getGroupBalances);
router.put('/:groupId', updateGroup);
router.post('/:groupId/members', addGroupMember);
router.put('/:groupId/members/:userId', updateGroupMember);
router.delete('/:groupId/members/:userId', removeGroupMember);

module.exports = router;
