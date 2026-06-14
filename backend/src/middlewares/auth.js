const jwt = require('jsonwebtoken');
const prisma = require('../services/db');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey';

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Access token missing or invalid' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    // Fetch user to ensure they still exist and are not soft-deleted
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user || user.isDeleted) {
      return res.status(401).json({ error: 'User not found or account deactivated' });
    }

    // Attach user information to request
    req.user = {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Access token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid access token' });
  }
}

module.exports = {
  authenticate,
  JWT_SECRET
};
