const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const VerificationToken = require('../models/VerificationToken');
const { sendVerificationEmail } = require('../utils/mailer');
const { getLocalDate } = require('../utils/balance');

const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

// ── POST /api/auth/register ─────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    let user = await User.findOne({ email: email.toLowerCase() });
    if (user) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    if (!user) {
      user = new User({ name, email, password, isVerified: false });
      await user.save();
    }

    const code = generateCode();
    const token = crypto.randomBytes(32).toString('hex');
    const ipAddress = req.ip || req.connection.remoteAddress;

    await VerificationToken.deleteMany({ userId: user._id, action: 'signup' });
    await VerificationToken.create({
      userId: user._id,
      action: 'signup',
      code,
      token,
      ipAddress,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000)
    });

    const magicLink = `${req.protocol}://${req.get('host')}/api/auth/verify?token=${token}&action=signup`;
    await sendVerificationEmail(user.email, code, magicLink, false);

    res.status(201).json({
      message: 'Verification email sent. Please check your inbox.',
      userId: user._id
    });
  } catch (err) {
    console.error('[AUTH] Register error:', err.message);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ── POST /api/auth/login ────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.isVerified) {
      return res.status(403).json({ error: 'Please verify your email address first', requiresVerification: true, userId: user._id });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.cookie('athlon_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    res.json({
      message: 'Login successful',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        onboardingComplete: user.onboardingComplete,
        theme: user.theme,
        profile: user.profile
      },
      token
    });
  } catch (err) {
    console.error('[AUTH] Login error:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ── POST /api/auth/verify (Submit Code or Token with Password) ──────────────
router.post('/verify', async (req, res) => {
  try {
    const { userId, code, token, action, newPassword } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;

    let query = { action, used: false, expiresAt: { $gt: new Date() } };
    if (code && userId) {
      query.userId = userId;
      query.code = code;
    } else if (token) {
      query.token = token;
    } else {
      return res.status(400).json({ error: 'Provide code and userId, or token' });
    }

    const vToken = await VerificationToken.findOne(query);
    if (!vToken) {
      return res.status(400).json({ error: 'Invalid or expired code/token' });
    }

    if (vToken.ipAddress !== ipAddress) {
      return res.status(403).json({ error: 'IP address mismatch' });
    }

    vToken.used = true;
    await vToken.save();

    const user = await User.findById(vToken.userId);
    if (action === 'signup') {
      user.isVerified = true;
      await user.save();
      
      const jwtToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
      res.cookie('athlon_token', jwtToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000
      });
      return res.json({ message: 'Account verified successfully', token: jwtToken, user: { id: user._id, name: user.name, email: user.email, onboardingComplete: user.onboardingComplete, theme: user.theme } });
    } else if (action === 'password_reset') {
      if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
      user.password = newPassword;
      await user.save();
      return res.json({ message: 'Password changed successfully' });
    }
  } catch (err) {
    console.error('[AUTH] Verify error:', err.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ── GET /api/auth/verify (Magic Link) ───────────────────────────────────────
router.get('/verify', async (req, res) => {
  try {
    const { token, action } = req.query;
    const ipAddress = req.ip || req.connection.remoteAddress;

    const vToken = await VerificationToken.findOne({
      token,
      action,
      used: false,
      expiresAt: { $gt: new Date() }
    });

    if (!vToken) {
      return res.status(400).send('Invalid or expired link');
    }

    if (vToken.ipAddress !== ipAddress) {
      return res.status(403).send('IP address mismatch');
    }

    if (action === 'signup') {
      vToken.used = true;
      await vToken.save();
      
      const user = await User.findById(vToken.userId);
      user.isVerified = true;
      await user.save();
      
      const jwtToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
      res.cookie('athlon_token', jwtToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000
      });
      return res.redirect('/?verified=true');
    } else if (action === 'password_reset') {
      // Don't mark as used yet, let the frontend submit the new password with this token
      return res.redirect(`/?reset_token=${token}`);
    }
  } catch (err) {
    console.error('[AUTH] Verify Magic Link error:', err.message);
    res.status(500).send('Verification failed');
  }
});

// ── POST /api/auth/forgot-password ──────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      // Always return success to prevent email enumeration
      return res.json({ message: 'If that email is registered, we have sent a reset link.', userId: null });
    }

    const code = generateCode();
    const token = crypto.randomBytes(32).toString('hex');
    const ipAddress = req.ip || req.connection.remoteAddress;

    await VerificationToken.deleteMany({ userId: user._id, action: 'password_reset' });
    
    await VerificationToken.create({
      userId: user._id,
      action: 'password_reset',
      code,
      token,
      ipAddress,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000)
    });

    const magicLink = `${req.protocol}://${req.get('host')}/api/auth/verify?token=${token}&action=password_reset`;
    await sendVerificationEmail(user.email, code, magicLink, true);

    res.json({ message: 'If that email is registered, we have sent a reset link.', userId: user._id });
  } catch (err) {
    console.error('[AUTH] Forgot password error:', err.message);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// ── POST /api/auth/logout ───────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('athlon_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  });
  res.json({ message: 'Logged out successfully' });
});

// ── GET /api/auth/me ────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  try {
    const token = req.cookies?.athlon_token || req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password -onboardingMessages');

    if (!user) return res.status(401).json({ error: 'User not found' });
    if (!user.isVerified) return res.status(403).json({ error: 'User not verified' });

    let balance = null;
    if (user.onboardingComplete && user.profile?.tdee) {
      const localDate = getLocalDate(user.profile?.timezone);
      const { getTodayBalance } = require('../utils/balance');
      balance = await getTodayBalance(user._id, localDate);
    }

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        onboardingComplete: user.onboardingComplete,
        theme: user.theme,
        profile: user.profile,
        notifications: {
          enabled: user.notifications?.enabled,
          times: user.notifications?.times
        }
      },
      balance: balance ? {
        openingBalance: balance.openingBalance,
        currentBalance: balance.currentBalance,
        caloriesConsumed: balance.caloriesConsumed,
        caloriesBurnt: balance.caloriesBurnt,
        carryover: balance.carryover
      } : null
    });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

module.exports = router;
