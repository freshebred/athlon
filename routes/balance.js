const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const DailyBalance = require('../models/DailyBalance');
const MealLog = require('../models/MealLog');
const WorkoutLog = require('../models/WorkoutLog');
const { getTodayBalance, getLocalDate } = require('../utils/balance');

// ── GET /api/balance/today ──────────────────────────────────────────────────
router.get('/today', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.profile?.tdee) {
      return res.status(400).json({ error: 'Please complete onboarding first' });
    }

    const localDate = getLocalDate(user.profile?.timezone);
    const balance = await getTodayBalance(user._id, localDate);

    // Get today's meals for breakdown
    const [meals, workouts] = await Promise.all([
      MealLog.find({ userId: user._id, localDate, isDeleted: false }).sort({ loggedAt: -1 }),
      WorkoutLog.find({ userId: user._id, localDate }).sort({ loggedAt: -1 })
    ]);

    res.json({
      localDate,
      balance: {
        openingBalance: balance.openingBalance,
        currentBalance: balance.currentBalance,
        caloriesConsumed: balance.caloriesConsumed,
        caloriesBurnt: balance.caloriesBurnt,
        carryover: balance.carryover,
        tdee: user.profile.tdee
      },
      meals: meals.map(m => ({
        id: m._id,
        name: m.name,
        totalCalories: m.totalCalories,
        totalProtein: m.totalProtein,
        totalCarbs: m.totalCarbs,
        totalFat: m.totalFat,
        logType: m.logType,
        ingredients: m.ingredients,
        loggedAt: m.loggedAt
      })),
      workouts: workouts.map(w => ({
        id: w._id,
        activityType: w.activityType,
        duration: w.duration,
        caloriesBurnt: w.finalCaloriesBurnt ?? w.caloriesBurnt,
        loggedAt: w.loggedAt
      }))
    });
  } catch (err) {
    console.error('[BALANCE] Today error:', err.message);
    res.status(500).json({ error: 'Failed to fetch balance.' });
  }
});

// ── GET /api/balance/history ────────────────────────────────────────────────
router.get('/history', requireAuth, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const balances = await DailyBalance.find({ userId: req.user._id })
      .sort({ localDate: -1 })
      .limit(Number(days));

    res.json({ balances });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch balance history.' });
  }
});

module.exports = router;
