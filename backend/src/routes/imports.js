const express = require('express');
const multer = require('multer');
const {
  uploadCSV,
  getImportReport,
  setExchangeRate,
  resolveRow,
  commitImport
} = require('../controllers/imports');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(authenticate);

router.post('/upload', upload.single('file'), uploadCSV);
router.get('/:sessionId/report', getImportReport);
router.post('/:sessionId/rate', setExchangeRate);
router.post('/:sessionId/resolve/:rowId', resolveRow);
router.post('/:sessionId/commit', commitImport);

module.exports = router;
