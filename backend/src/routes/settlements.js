const express = require('express');
const {
  createSettlement,
  getSettlementsByGroup,
  updateSettlement,
  deleteSettlement
} = require('../controllers/settlements');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

router.use(authenticate);

router.post('/', createSettlement);
router.get('/', getSettlementsByGroup);
router.put('/:settlementId', updateSettlement);
router.delete('/:settlementId', deleteSettlement);

module.exports = router;
