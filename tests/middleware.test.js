/**
 * tests/middleware.test.js
 * Tests for middleware/auth.js: requireAuth and optionalAuth.
 */

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const express = require('express');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { createUser } = require('./helpers');

let app;

beforeAll(() => {
  // Build a minimal test app for middleware testing
  app = express();
  app.use(require('cookie-parser')());
  app.use(express.json());

  app.get('/protected', requireAuth, (req, res) => {
    res.json({ userId: req.user._id, name: req.user.name });
  });

  app.get('/optional', optionalAuth, (req, res) => {
    res.json({ hasUser: !!req.user, userId: req.user?._id || null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('requireAuth middleware', () => {
  it('should allow access with valid Bearer token in Authorization header', async () => {
    const user = await createUser({ email: `mw1-${Date.now()}@test.com` });
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe(user.name);
  });

  it('should return 401 when no token is provided', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it('should return 401 with an expired token', async () => {
    const user = await createUser({ email: `mw2-${Date.now()}@test.com` });
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '-1s' });

    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid or expired/i);
  });

  it('should return 401 with a malformed token', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer not.a.real.token');

    expect(res.status).toBe(401);
  });

  it('should return 401 with wrong JWT secret', async () => {
    const user = await createUser({ email: `mw3-${Date.now()}@test.com` });
    const token = jwt.sign({ userId: user._id }, 'wrong_secret', { expiresIn: '1h' });

    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('should return 401 when user no longer exists in DB', async () => {
    const { Types } = require('mongoose');
    const fakeId = new Types.ObjectId();
    const token = jwt.sign({ userId: fakeId }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/user not found/i);
  });

  it('should populate req.user with user data (excluding password)', async () => {
    const user = await createUser({ email: `mw4-${Date.now()}@test.com` });
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(String(res.body.userId)).toBe(String(user._id));
    expect(res.body).not.toHaveProperty('password');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('optionalAuth middleware', () => {
  it('should set req.user when valid token is provided', async () => {
    const user = await createUser({ email: `mw-opt1-${Date.now()}@test.com` });
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const res = await request(app)
      .get('/optional')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.hasUser).toBe(true);
    expect(res.body.userId).toBeDefined();
  });

  it('should set req.user to undefined when no token provided (but not fail)', async () => {
    const res = await request(app).get('/optional');
    expect(res.status).toBe(200);
    expect(res.body.hasUser).toBe(false);
  });

  it('should silently ignore invalid tokens and continue request', async () => {
    const res = await request(app)
      .get('/optional')
      .set('Authorization', 'Bearer invalid.token.here');

    expect(res.status).toBe(200);
    expect(res.body.hasUser).toBe(false);
  });
});
