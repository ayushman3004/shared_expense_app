const express = require('express');
const { signup, login, refresh, logout, me, oauthMock, updateProfile, deactivateAccount } = require('../controllers/auth');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

router.post('/signup', signup);
router.post('/login', login);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', authenticate, me);
router.post('/google', oauthMock);
router.put('/profile', authenticate, updateProfile);
router.delete('/profile', authenticate, deactivateAccount);

module.exports = router;
