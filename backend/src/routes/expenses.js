const express = require('express');
const {
  createExpense,
  getExpensesByGroup,
  updateExpense,
  deleteExpense
} = require('../controllers/expenses');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

router.use(authenticate);

router.post('/', createExpense);
router.get('/', getExpensesByGroup);
router.put('/:expenseId', updateExpense);
router.delete('/:expenseId', deleteExpense);

module.exports = router;
