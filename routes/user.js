const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const { getLocalDate, getTodayBalance } = require('../utils/balance');

// ── GET /api/user/profile ───────────────────────────────────────────────────
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password -onboardingMessages');
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile.' });
  }
});

// ── PUT /api/user/profile ───────────────────────────────────────────────────
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { name, profile, theme } = req.body;
    const user = await User.findById(req.user._id);

    if (name) user.name = name;
    if (theme) user.theme = theme;

    if (profile) {
      user.profile = { ...user.profile.toObject(), ...profile };
      // Recalculate TDEE if stats changed
      const tdee = user.calculateTDEE();
      if (tdee) user.profile.tdee = tdee;
    }

    await user.save();

    res.json({
      message: 'Profile updated',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        profile: user.profile,
        theme: user.theme
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// ── PUT /api/user/theme ─────────────────────────────────────────────────────
router.put('/theme', requireAuth, async (req, res) => {
  try {
    const { theme } = req.body;
    if (!['dark', 'light'].includes(theme)) {
      return res.status(400).json({ error: 'Invalid theme value' });
    }
    await User.findByIdAndUpdate(req.user._id, { theme });
    res.json({ theme });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update theme.' });
  }
});

// ── GET /api/user/stats ─────────────────────────────────────────────────────
// Summary stats for profile page
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const MealLog = require('../models/MealLog');
    const WorkoutLog = require('../models/WorkoutLog');
    const DailyBalance = require('../models/DailyBalance');

    const [totalMeals, totalWorkouts, last7Balances] = await Promise.all([
      MealLog.countDocuments({ userId: req.user._id, isDeleted: false }),
      WorkoutLog.countDocuments({ userId: req.user._id }),
      DailyBalance.find({ userId: req.user._id })
        .sort({ localDate: -1 })
        .limit(7)
    ]);

    const avgBalance = last7Balances.length > 0
      ? Math.round(last7Balances.reduce((sum, b) => sum + b.currentBalance, 0) / last7Balances.length)
      : 0;

    const daysUnderBudget = last7Balances.filter(b => b.currentBalance >= 0).length;

    res.json({
      totalMeals,
      totalWorkouts,
      daysUnderBudget,
      avgBalance,
      last7Balances: last7Balances.map(b => ({
        date: b.localDate,
        balance: b.currentBalance,
        consumed: b.caloriesConsumed,
        burnt: b.caloriesBurnt
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

module.exports = router;
