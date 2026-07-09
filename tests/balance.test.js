/**
 * tests/balance.test.js
 * Tests for /api/balance/today and /api/balance/history endpoints.
 */

const request    = require('supertest');
const { buildApp, createUser, createMeal, createWorkout, createBalance, authHeader } = require('./helpers');
const DailyBalance = require('../models/DailyBalance');
const { getLocalDate } = require('../utils/balance');
const { Types }  = require('mongoose');

let app, user, TODAY;

beforeAll(() => {
  app = buildApp();
});

beforeEach(async () => {
  TODAY = getLocalDate('America/Chicago');
  user = await createUser({ email: `balance-test-${Date.now()}@test.com` });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/balance/today', () => {
  it('should return today\'s balance with meals and workouts', async () => {
    await createBalance(user._id, { localDate: TODAY });
    await createMeal(user._id,    { totalCalories: 500, localDate: TODAY });
    await createWorkout(user._id, { caloriesBurnt: 200, localDate: TODAY });

    const res = await request(app)
      .get('/api/balance/today')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.balance).toHaveProperty('openingBalance');
    expect(res.body.balance).toHaveProperty('currentBalance');
    expect(res.body.balance).toHaveProperty('caloriesConsumed');
    expect(res.body.balance).toHaveProperty('caloriesBurnt');
    expect(res.body.balance).toHaveProperty('tdee');
    expect(Array.isArray(res.body.meals)).toBe(true);
    expect(Array.isArray(res.body.workouts)).toBe(true);
    expect(res.body.localDate).toBeDefined();
  });

  it('should return 400 when user has not completed onboarding (no TDEE)', async () => {
    const unonboarded = await createUser({
      email: `unon-${Date.now()}@test.com`,
      onboardingComplete: false,
      profile: {}  // no TDEE
    });

    const res = await request(app)
      .get('/api/balance/today')
      .set(authHeader(unonboarded));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/onboarding/i);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).get('/api/balance/today');
    expect(res.status).toBe(401);
  });

  it('should create a balance record if one does not exist', async () => {
    // No createBalance called - should auto-create
    const res = await request(app)
      .get('/api/balance/today')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.balance.openingBalance).toBe(user.profile.tdee);
  });

  it('should not include soft-deleted meals in listing', async () => {
    await createBalance(user._id, { localDate: TODAY });
    await createMeal(user._id, { isDeleted: true,  name: 'Deleted', localDate: TODAY });
    await createMeal(user._id, { isDeleted: false, name: 'Active',  localDate: TODAY });

    const res = await request(app)
      .get('/api/balance/today')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.meals.every(m => m.name !== 'Deleted')).toBe(true);
  });

  it('should include meal macros in response', async () => {
    await createBalance(user._id, { localDate: TODAY });
    await createMeal(user._id, {
      totalCalories: 400, totalProtein: 30, totalCarbs: 40, totalFat: 10, localDate: TODAY
    });

    const res = await request(app)
      .get('/api/balance/today')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    const meal = res.body.meals[0];
    expect(meal).toHaveProperty('totalProtein');
    expect(meal).toHaveProperty('totalCarbs');
    expect(meal).toHaveProperty('totalFat');
  });

  it('should return finalCaloriesBurnt for workouts with PT adjustment', async () => {
    await createBalance(user._id, { localDate: TODAY });
    await createWorkout(user._id, { caloriesBurnt: 270, finalCaloriesBurnt: 350, ptDisputed: true, localDate: TODAY });

    const res = await request(app)
      .get('/api/balance/today')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.workouts[0].caloriesBurnt).toBe(350); // uses finalCaloriesBurnt
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/balance/history', () => {
  it('should return balance history for the last 30 days by default', async () => {
    await createBalance(user._id, { localDate: '2026-07-01' });
    await createBalance(user._id, { localDate: '2026-07-05' });
    await createBalance(user._id, { localDate: '2026-07-06' });

    const res = await request(app)
      .get('/api/balance/history')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.balances)).toBe(true);
    expect(res.body.balances.length).toBe(3);
  });

  it('should support days parameter', async () => {
    for (let i = 1; i <= 10; i++) {
      await createBalance(user._id, { localDate: `2026-06-${String(i).padStart(2, '0')}` });
    }

    const res = await request(app)
      .get('/api/balance/history?days=5')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.balances.length).toBeLessThanOrEqual(5);
  });

  it('should return balances sorted by date descending', async () => {
    await createBalance(user._id, { localDate: '2026-07-01', currentBalance: 2000 });
    await createBalance(user._id, { localDate: '2026-07-03', currentBalance: 1800 });
    await createBalance(user._id, { localDate: '2026-07-05', currentBalance: 2100 });

    const res = await request(app)
      .get('/api/balance/history')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    const dates = res.body.balances.map(b => b.localDate);
    expect(dates[0]).toBe('2026-07-05');
    expect(dates[dates.length - 1]).toBe('2026-07-01');
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).get('/api/balance/history');
    expect(res.status).toBe(401);
  });

  it('should not return other users\' balances', async () => {
    const otherUser = await createUser({ email: `other-bal-${Date.now()}@test.com` });
    await createBalance(otherUser._id, { localDate: '2026-07-01' });
    await createBalance(user._id, { localDate: '2026-07-02' });

    const res = await request(app)
      .get('/api/balance/history')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.balances.length).toBe(1);
    expect(res.body.balances[0].localDate).toBe('2026-07-02');
  });
});
