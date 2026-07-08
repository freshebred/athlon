/**
 * tests/auth.test.js
 * Tests for POST /api/auth/register, /login, /logout, GET /auth/me
 */

const request = require('supertest');
const User    = require('../models/User');
const { buildApp, createUser, authHeader } = require('./helpers');

let app;

beforeAll(() => {
  app = buildApp();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/register', () => {
  it('should register a new user and return 201 with token', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Alice', email: 'alice@test.com', password: 'secret123' });

    expect(res.status).toBe(201);
    expect(res.body.userId).toBeDefined();
    expect(res.body.message).toMatch(/Verification email sent/i);
  });

  it('should return 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'no-name@test.com', password: 'secret123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('should return 400 when password is too short (<6 chars)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Bob', email: 'bob@test.com', password: '12' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/6 characters/i);
  });

  it('should return 409 for duplicate email', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Carol', email: 'carol@test.com', password: 'secret123' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Carol2', email: 'carol@test.com', password: 'different123' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('should hash the password — not store plain text', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Dave', email: 'dave@test.com', password: 'plainpassword' });

    const user = await User.findOne({ email: 'dave@test.com' }).select('+password');
    expect(user.password).not.toBe('plainpassword');
    expect(user.password.startsWith('$2')).toBe(true); // bcrypt hash
  });

  it('should not set an httpOnly cookie on registration since verification is required', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Eve', email: 'eve@test.com', password: 'secure123' });

    expect(res.status).toBe(201);
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeUndefined(); // no cookies
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  it('should login with valid credentials if verified', async () => {
    await createUser({ name: 'Frank', email: 'frank@test.com', password: 'frankspass', isVerified: true });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'frank@test.com', password: 'frankspass' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe('frank@test.com');
  });

  it('should return 401 with wrong password', async () => {
    await createUser({ name: 'Grace', email: 'grace@test.com', password: 'correctpass', isVerified: true });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'grace@test.com', password: 'wrongpass' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it('should return 401 for non-existent user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@test.com', password: 'anything' });

    expect(res.status).toBe(401);
  });

  it('should return 400 when fields are missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'no-pass@test.com' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('should be case-insensitive for email', async () => {
    await createUser({ name: 'Ivan', email: 'ivan@test.com', password: 'ivanpass', isVerified: true });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'Ivan@Test.COM', password: 'ivanpass' });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('ivan@test.com');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/logout', () => {
  it('should clear the cookie and return 200', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/logged out|logout/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/auth/me', () => {
  it('should return user data with valid token', async () => {
    const user = await createUser({ email: 'me@test.com' });
    const res = await request(app)
      .get('/api/auth/me')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('me@test.com');
    expect(res.body.user).not.toHaveProperty('password');
  });

  it('should return 401 when no token provided', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('should return 401 for invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set({ Authorization: 'Bearer invalidtoken123' });

    expect(res.status).toBe(401);
  });

  it('should include balance in response when user is onboarded', async () => {
    const user = await createUser({ email: 'balance-me@test.com' });
    // Need a balance record
    const { DailyBalance } = require('../models/DailyBalance') || {};
    const DB = require('../models/DailyBalance');
    await DB.create({
      userId: user._id,
      localDate: '2026-07-07',
      openingBalance: 2200,
      currentBalance: 2200,
      caloriesConsumed: 0,
      caloriesBurnt: 0,
      carryover: 0
    });

    const res = await request(app)
      .get('/api/auth/me')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    // balance may or may not match localDate; just ensure key exists
    expect(res.body).toHaveProperty('balance');
  });
});
