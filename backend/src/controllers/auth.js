const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../services/db');
const { JWT_SECRET } = require('../middlewares/auth');

const REFRESH_SECRET = process.env.REFRESH_SECRET || 'supersecretrefreshkey';
const ACCESS_EXPIRY = '15m';
const REFRESH_EXPIRY_DAYS = 7;

// Helper to generate access and refresh tokens
async function generateTokens(userId) {
  const accessToken = jwt.sign({ userId }, JWT_SECRET, { expiresIn: ACCESS_EXPIRY });
  
  // Generate a random refresh token
  const refreshTokenString = jwt.sign({ userId, type: 'refresh' }, REFRESH_SECRET, { expiresIn: `${REFRESH_EXPIRY_DAYS}d` });
  
  // Store refresh token in database
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_EXPIRY_DAYS);
  
  await prisma.refreshToken.create({
    data: {
      userId,
      token: refreshTokenString,
      expiresAt
    }
  });

  return { accessToken, refreshToken: refreshTokenString };
}

// Signup Controller
async function signup(req, res, next) {
  try {
    const { name, username, email, password } = req.body;

    if (!name || !username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check unique constraints
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username: username.toLowerCase() },
          { email: email.toLowerCase() }
        ]
      }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Username or Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create User
    const user = await prisma.user.create({
      data: {
        name,
        username: username.toLowerCase().trim(),
        email: email.toLowerCase().trim(),
        passwordHash
      }
    });

    const tokens = await generateTokens(user.id);

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email
      },
      ...tokens
    });
  } catch (error) {
    next(error);
  }
}

// Login Controller
async function login(req, res, next) {
  try {
    const { identifier, password } = req.body; // identifier can be username or email

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Identifier and password are required' });
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: identifier.toLowerCase().trim() },
          { email: identifier.toLowerCase().trim() }
        ]
      }
    });

    if (!user || user.isDeleted) {
      return res.status(401).json({ error: 'Invalid username/email or password' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid username/email or password' });
    }

    const tokens = await generateTokens(user.id);

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email
      },
      ...tokens
    });
  } catch (error) {
    next(error);
  }
}

// Refresh Token Rotation Controller
async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    // Find the token in the DB
    const dbToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken }
    });

    if (!dbToken) {
      // Security Alert: If someone tries to reuse a refresh token that isn't in the DB, 
      // or if it was already rotated (revoked), this might be a theft attempt. 
      // Clean up all refresh tokens for this user as a precaution.
      try {
        const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
        await prisma.refreshToken.deleteMany({
          where: { userId: decoded.userId }
        });
      } catch (err) {
        // Token was invalid or expired anyway
      }
      return res.status(403).json({ error: 'Invalid or revoked refresh token' });
    }

    // Verify token expiry
    if (dbToken.expiresAt < new Date()) {
      await prisma.refreshToken.delete({ where: { id: dbToken.id } });
      return res.status(401).json({ error: 'Refresh token expired' });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, REFRESH_SECRET);
    } catch (error) {
      await prisma.refreshToken.delete({ where: { id: dbToken.id } });
      return res.status(401).json({ error: 'Invalid refresh token signature' });
    }

    // Delete the old refresh token (Rotation!)
    await prisma.refreshToken.delete({ where: { id: dbToken.id } });

    // Generate new tokens
    const tokens = await generateTokens(decoded.userId);

    res.json(tokens);
  } catch (error) {
    next(error);
  }
}

// Logout Controller
async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await prisma.refreshToken.deleteMany({
        where: { token: refreshToken }
      });
    }
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
}

// Me Controller
async function me(req, res, next) {
  try {
    res.json({ user: req.user });
  } catch (error) {
    next(error);
  }
}

// Google OAuth Mock / Real Controller
async function oauthMock(req, res, next) {
  try {
    const { email, name, googleId, idToken } = req.body;

    let targetEmail = email;
    let targetName = name;
    let targetGoogleId = googleId;

    if (idToken) {
      // Real Google Token Verification via Google's tokeninfo API
      try {
        const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
        if (!verifyRes.ok) {
          return res.status(400).json({ error: 'Invalid Google ID Token' });
        }
        const tokenInfo = await verifyRes.json();
        
        // Verify client ID if set and not placeholder
        const clientId = process.env.GOOGLE_CLIENT_ID;
        if (clientId && clientId !== 'your-google-client-id.apps.googleusercontent.com' && tokenInfo.aud !== clientId) {
          return res.status(400).json({ error: 'Google Client ID mismatch' });
        }

        targetEmail = tokenInfo.email;
        targetName = tokenInfo.name;
        targetGoogleId = tokenInfo.sub;
      } catch (err) {
        return res.status(500).json({ error: 'Google token validation failed' });
      }
    }

    if (!targetEmail || !targetName) {
      return res.status(400).json({ error: 'Email and Name are required for Google OAuth' });
    }

    // Try finding the user by email
    let user = await prisma.user.findUnique({
      where: { email: targetEmail.toLowerCase().trim() }
    });

    if (!user) {
      // Auto-register via Google OAuth
      let username = targetEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
      
      // Handle collision
      let suffix = 1;
      let checkUsername = username;
      while (await prisma.user.findUnique({ where: { username: checkUsername } })) {
        checkUsername = `${username}${suffix}`;
        suffix++;
      }
      username = checkUsername;

      // Mock password hash for OAuth users
      const passwordHash = await bcrypt.hash(`oauth-${targetGoogleId || Math.random()}`, 10);

      user = await prisma.user.create({
        data: {
          name: targetName,
          username,
          email: targetEmail.toLowerCase().trim(),
          passwordHash
        }
      });
    }

    const tokens = await generateTokens(user.id);

    res.json({
      message: 'OAuth login successful',
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email
      },
      ...tokens
    });
  } catch (error) {
    next(error);
  }
}

// Update User Profile
async function updateProfile(req, res, next) {
  try {
    const { name, username, email } = req.body;
    const userId = req.user.id;

    if (!name || !username || !email) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check uniqueness if username or email is changing
    const existingUser = await prisma.user.findFirst({
      where: {
        id: { not: userId },
        OR: [
          { username: username.toLowerCase().trim() },
          { email: email.toLowerCase().trim() }
        ]
      }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Username or Email is already in use by another account' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        name,
        username: username.toLowerCase().trim(),
        email: email.toLowerCase().trim()
      }
    });

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        username: updatedUser.username,
        email: updatedUser.email
      }
    });
  } catch (error) {
    next(error);
  }
}

// Soft-deactivate Account
async function deactivateAccount(req, res, next) {
  try {
    const userId = req.user.id;

    await prisma.$transaction(async (tx) => {
      // Soft-delete user
      await tx.user.update({
        where: { id: userId },
        data: { isDeleted: true }
      });

      // Clear refresh tokens
      await tx.refreshToken.deleteMany({
        where: { userId }
      });
    });

    res.json({ message: 'Account deactivated successfully' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  signup,
  login,
  refresh,
  logout,
  me,
  oauthMock,
  updateProfile,
  deactivateAccount
};
