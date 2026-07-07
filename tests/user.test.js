/**
 * tests/user.test.js
 * Tests for /api/user/* endpoints: profile get/update, theme, stats.
 */

const request = require('supertest');
const { buildApp, createUser, createMeal, createWorkout, createBalance, authHeader } = require('./helpers');
const User = require('../models/User');

let app, user;

beforeAll(() => {
  app = buildApp();
});

beforeEach(async () => {
  user = await createUser({ email: `user-test-${Date.now()}@test.com` });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/user/profile', () => {
  it('should return user profile (without password)', async () => {
    const res = await request(app)
      .get('/api/user/profile')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(user.email);
    expect(res.body.user.name).toBe(user.name);
    expect(res.body.user).not.toHaveProperty('password');
    expect(res.body.user).not.toHaveProperty('onboardingMessages');
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).get('/api/user/profile');
    expect(res.status).toBe(401);
  });

  it('should include profile stats in response', async () => {
    const res = await request(app)
      .get('/api/user/profile')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.user.profile).toBeDefined();
    expect(res.body.user.profile.tdee).toBe(2200);
    expect(res.body.user.profile.timezone).toBe('America/Chicago');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /api/user/profile', () => {
  it('should update user name', async () => {
    const res = await request(app)
      .put('/api/user/profile')
      .set(authHeader(user))
      .send({ name: 'Updated Name' });

    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Updated Name');

    const dbUser = await User.findById(user._id);
    expect(dbUser.name).toBe('Updated Name');
  });

  it('should update theme', async () => {
    const res = await request(app)
      .put('/api/user/profile')
      .set(authHeader(user))
      .send({ theme: 'light' });

    expect(res.status).toBe(200);
    expect(res.body.user.theme).toBe('light');
  });

  it('should update profile stats and recalculate TDEE', async () => {
    const res = await request(app)
      .put('/api/user/profile')
      .set(authHeader(user))
      .send({
        profile: {
          age:           30,
          weight:        80,
          height:        180,
          sex:           'male',
          activityLevel: 'active',
          goal:          'maintain'
        }
      });

    expect(res.status).toBe(200);
    // TDEE should be recalculated
    expect(res.body.user.profile.tdee).toBeDefined();
    // active multiplier should yield higher TDEE than moderate (2200)
    expect(res.body.user.profile.tdee).toBeGreaterThan(2000);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .put('/api/user/profile')
      .send({ name: 'Hacker' });

    expect(res.status).toBe(401);
  });

  it('should only update fields provided', async () => {
    const res = await request(app)
      .put('/api/user/profile')
      .set(authHeader(user))
      .send({ name: 'Partial Update' });

    expect(res.status).toBe(200);
    // Profile should still exist
    expect(res.body.user.profile).toBeDefined();
    expect(res.body.user.email).toBe(user.email);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /api/user/theme', () => {
  it('should toggle theme to light', async () => {
    const res = await request(app)
      .put('/api/user/theme')
      .set(authHeader(user))
      .send({ theme: 'light' });

    expect(res.status).toBe(200);
    expect(res.body.theme).toBe('light');

    const dbUser = await User.findById(user._id);
    expect(dbUser.theme).toBe('light');
  });

  it('should toggle theme back to dark', async () => {
    const res = await request(app)
      .put('/api/user/theme')
      .set(authHeader(user))
      .send({ theme: 'dark' });

    expect(res.status).toBe(200);
    expect(res.body.theme).toBe('dark');
  });

  it('should return 400 for invalid theme value', async () => {
    const res = await request(app)
      .put('/api/user/theme')
      .set(authHeader(user))
      .send({ theme: 'purple' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .put('/api/user/theme')
      .send({ theme: 'light' });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/user/stats', () => {
  it('should return aggregated stats', async () => {
    await createMeal(user._id);
    await createMeal(user._id, { name: 'Second Meal' });
    await createWorkout(user._id);
    await createBalance(user._id, { localDate: '2026-07-07', currentBalance: 1500 });

    const res = await request(app)
      .get('/api/user/stats')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.totalMeals).toBe(2);
    expect(res.body.totalWorkouts).toBe(1);
    expect(res.body).toHaveProperty('daysUnderBudget');
    expect(res.body).toHaveProperty('avgBalance');
    expect(Array.isArray(res.body.last7Balances)).toBe(true);
  });

  it('should not count soft-deleted meals', async () => {
    await createMeal(user._id, { name: 'Active Meal', isDeleted: false });
    await createMeal(user._id, { name: 'Deleted Meal', isDeleted: true });

    const res = await request(app)
      .get('/api/user/stats')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.totalMeals).toBe(1);
  });

  it('should calculate daysUnderBudget correctly', async () => {
    // 3 days above budget (positive balance), 1 day below
    await createBalance(user._id, { localDate: '2026-07-01', currentBalance:  500 });
    await createBalance(user._id, { localDate: '2026-07-02', currentBalance:  200 });
    await createBalance(user._id, { localDate: '2026-07-03', currentBalance:  100 });
    await createBalance(user._id, { localDate: '2026-07-04', currentBalance: -300 });

    const res = await request(app)
      .get('/api/user/stats')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.daysUnderBudget).toBe(3); // days with balance >= 0
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).get('/api/user/stats');
    expect(res.status).toBe(401);
  });

  it('should return 0 stats when user has no data', async () => {
    const res = await request(app)
      .get('/api/user/stats')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.totalMeals).toBe(0);
    expect(res.body.totalWorkouts).toBe(0);
    expect(res.body.avgBalance).toBe(0);
  });
});
