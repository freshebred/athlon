/**
 * tests/helpers.js
 * Shared test helpers: build app, create users, generate tokens, etc.
 */

const jwt         = require('jsonwebtoken');
const User        = require('../models/User');
const DailyBalance = require('../models/DailyBalance');
const MealLog     = require('../models/MealLog');
const WorkoutLog  = require('../models/WorkoutLog');
const PTConversation = require('../models/PTConversation');

// ── Build a test-app (after env vars are set by setup.js) ───────────────────
function buildApp() {
  // Clear require cache so fresh app.js picks up env vars
  delete require.cache[require.resolve('../app.js')];
  return require('../app.js');
}

// ── Create a fully onboarded test user ─────────────────────────────────────
async function createUser(overrides = {}) {
  const defaults = {
    name:  'Test User',
    email: `test${Date.now()}@example.com`,
    password: 'password123',
    onboardingComplete: true,
    profile: {
      age:           25,
      weight:        70,
      height:        175,
      sex:           'male',
      activityLevel: 'moderate',
      goal:          'maintain',
      timezone:      'America/Chicago',
      unitSystem:    'metric',
      tdee:          2200
    }
  };
  const userData = { ...defaults, ...overrides };
  const user = new User(userData);
  await user.save();
  return user;
}

// ── Generate a valid JWT for a user ─────────────────────────────────────────
function authToken(user) {
  return jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
}

// ── Authorization header helper ─────────────────────────────────────────────
function authHeader(user) {
  return { Authorization: `Bearer ${authToken(user)}` };
}

// ── Create a daily balance record ─────────────────────────────────────────
async function createBalance(userId, overrides = {}) {
  const localDate = overrides.localDate || '2026-07-07';
  return DailyBalance.create({
    userId,
    localDate,
    openingBalance:   2200,
    carryover:        0,
    caloriesConsumed: 0,
    caloriesBurnt:    0,
    currentBalance:   2200,
    ...overrides
  });
}

// ── Create a meal log ────────────────────────────────────────────────────────
async function createMeal(userId, overrides = {}) {
  return MealLog.create({
    userId,
    name:          'Test Meal',
    logType:       'manual',
    ingredients: [{
      name:     'Test Food',
      amount:   100,
      unit:     'g',
      calories: 300,
      protein:  20,
      carbs:    30,
      fat:      10,
      verified: false
    }],
    totalCalories: 300,
    totalProtein:  20,
    totalCarbs:    30,
    totalFat:      10,
    aiVerdict:     'Test meal',
    localDate:     '2026-07-07',
    isDeleted:     false,
    editHistory:   [],
    ...overrides
  });
}

// ── Create a workout log ─────────────────────────────────────────────────────
async function createWorkout(userId, overrides = {}) {
  return WorkoutLog.create({
    userId,
    activityType:       'Running',
    duration:           30,
    intensity:          'moderate',
    imageVerified:      false,
    caloriesBurnt:      270,
    finalCaloriesBurnt: 270,
    localDate:          '2026-07-07',
    ...overrides
  });
}

// ── Create a PT conversation ─────────────────────────────────────────────────
async function createPTConversation(userId, overrides = {}) {
  return PTConversation.create({
    userId,
    context: { type: 'general' },
    messages: [],
    ...overrides
  });
}

module.exports = {
  buildApp,
  createUser,
  authToken,
  authHeader,
  createBalance,
  createMeal,
  createWorkout,
  createPTConversation
};
