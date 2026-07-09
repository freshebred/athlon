/**
 * tests/workouts.test.js
 * Tests for all /api/workouts/* endpoints.
 * AI (Groq) calls are mocked.
 */

const request  = require('supertest');
jest.mock('../utils/groq');

const { buildApp, createUser, createWorkout, createBalance, authHeader } = require('./helpers');
const { agentChat, parseAIJson, analyzeImage } = require('../utils/groq');
const WorkoutLog  = require('../models/WorkoutLog');
const DailyBalance = require('../models/DailyBalance');
const { getLocalDate } = require('../utils/balance');
const { Types }   = require('mongoose');

let app, user, TODAY;

beforeAll(() => {
  app = buildApp();
});

beforeEach(async () => {
  TODAY = getLocalDate('America/Chicago');
  user = await createUser({ email: `workouts-${Date.now()}@test.com` });
  await createBalance(user._id, { localDate: TODAY });

  // Default mock responses
  agentChat.mockResolvedValue(JSON.stringify({
    rawEstimate:      450,
    adjustedEstimate: 405,
    reasoning:        'Running at moderate pace for 30 minutes',
    intensity:        'moderate',
    met:              7.0
  }));

  parseAIJson.mockImplementation((text) => {
    try { return JSON.parse(text); } catch { return null; }
  });

  analyzeImage.mockResolvedValue(JSON.stringify({
    isWorkedOut: true,
    confidence:  'high',
    description: 'Person running on treadmill',
    reason:      'Clear exercise activity visible'
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/workouts/estimate-calories', () => {
  it('should return calorie estimate for a workout', async () => {
    const res = await request(app)
      .post('/api/workouts/estimate-calories')
      .set(authHeader(user))
      .send({ activityType: 'Running', duration: 30, intensity: 'moderate' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('rawEstimate');
    expect(res.body).toHaveProperty('adjustedEstimate');
    expect(res.body).toHaveProperty('reasoning');
    expect(res.body).toHaveProperty('met');
  });

  it('should return 400 when activityType is missing', async () => {
    const res = await request(app)
      .post('/api/workouts/estimate-calories')
      .set(authHeader(user))
      .send({ duration: 30 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('should return 400 when duration is missing', async () => {
    const res = await request(app)
      .post('/api/workouts/estimate-calories')
      .set(authHeader(user))
      .send({ activityType: 'Running' });

    expect(res.status).toBe(400);
  });

  it('should enforce 10% conservative reduction in adjustedEstimate', async () => {
    agentChat.mockResolvedValueOnce(JSON.stringify({
      rawEstimate: 500,
      adjustedEstimate: 400,  // AI might return anything
      reasoning: 'Test',
      intensity: 'high',
      met: 8.0
    }));
    parseAIJson.mockImplementationOnce((text) => JSON.parse(text));

    const res = await request(app)
      .post('/api/workouts/estimate-calories')
      .set(authHeader(user))
      .send({ activityType: 'Running', duration: 45, intensity: 'high' });

    expect(res.status).toBe(200);
    // adjustedEstimate should be rawEstimate * 0.9
    expect(res.body.adjustedEstimate).toBe(Math.round(res.body.rawEstimate * 0.9));
  });

  it('should use user weight from profile in calculation', async () => {
    agentChat.mockResolvedValueOnce(JSON.stringify({ rawEstimate: 300, adjustedEstimate: 270, reasoning: 'Calculated', intensity: 'low', met: 5.0 }));
    parseAIJson.mockImplementationOnce((text) => JSON.parse(text));

    const res = await request(app)
      .post('/api/workouts/estimate-calories')
      .set(authHeader(user))
      .send({ activityType: 'Cycling', duration: 60, intensity: 'low' });

    expect(res.status).toBe(200);
    // Verify agentChat was called with user weight in prompt
    const callArg = agentChat.mock.calls[agentChat.mock.calls.length - 1];
    expect(JSON.stringify(callArg)).toContain('70'); // user weight
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/workouts/estimate-calories')
      .send({ activityType: 'Running', duration: 30 });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/workouts/log', () => {
  it('should log a workout and add calories to balance', async () => {
    const res = await request(app)
      .post('/api/workouts/log')
      .set(authHeader(user))
      .send({
        activityType:   'Running',
        duration:       30,
        intensity:      'moderate',
        caloriesBurnt:  270,
        rawCaloriesBurnt: 300
      });

    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/logged/i);
    expect(res.body.workout.caloriesBurnt).toBe(270);
    expect(res.body.balance).toHaveProperty('currentBalance');
    expect(res.body.balance.currentBalance).toBe(2200 + 270);
  });

  it('should return 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/workouts/log')
      .set(authHeader(user))
      .send({ duration: 30 }); // missing activityType and caloriesBurnt

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('should return 400 when caloriesBurnt is missing', async () => {
    const res = await request(app)
      .post('/api/workouts/log')
      .set(authHeader(user))
      .send({ activityType: 'Yoga', duration: 60 });

    expect(res.status).toBe(400);
  });

  it('should save workout to database with correct fields', async () => {
    const res = await request(app)
      .post('/api/workouts/log')
      .set(authHeader(user))
      .send({
        activityType:  'Weightlifting',
        duration:      45,
        intensity:     'high',
        description:   'Leg day at the gym',
        caloriesBurnt: 350,
        imageVerified: false
      });

    expect(res.status).toBe(201);
    const workout = await WorkoutLog.findById(res.body.workout.id);
    expect(workout.activityType).toBe('Weightlifting');
    expect(workout.duration).toBe(45);
    expect(workout.intensity).toBe('high');
    expect(workout.caloriesBurnt).toBe(350);
    expect(workout.finalCaloriesBurnt).toBe(350);
    expect(workout.description).toBe('Leg day at the gym');
  });

  it('should update daily balance caloriesBurnt', async () => {
    await request(app)
      .post('/api/workouts/log')
      .set(authHeader(user))
      .send({ activityType: 'Yoga', duration: 60, caloriesBurnt: 200 });

    // Look up today's balance (same date the route uses)
    const balance = await DailyBalance.findOne({ userId: user._id, localDate: TODAY });
    expect(balance.caloriesBurnt).toBe(200);
  });

  it('should accept imageVerified flag', async () => {
    const res = await request(app)
      .post('/api/workouts/log')
      .set(authHeader(user))
      .send({
        activityType:  'Running',
        duration:      20,
        caloriesBurnt: 180,
        imageVerified: true,
        aiImageVerdict: 'Person clearly running outdoors'
      });

    expect(res.status).toBe(201);
    const workout = await WorkoutLog.findById(res.body.workout.id);
    expect(workout.imageVerified).toBe(true);
    expect(workout.aiImageVerdict).toBe('Person clearly running outdoors');
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/workouts/log')
      .send({ activityType: 'Running', duration: 30, caloriesBurnt: 250 });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/workouts/today', () => {
  it('should return workouts logged today', async () => {
    await createWorkout(user._id, { activityType: 'Running', localDate: TODAY });
    await createWorkout(user._id, { activityType: 'Yoga',    localDate: TODAY });

    const res = await request(app)
      .get('/api/workouts/today')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.workouts)).toBe(true);
    expect(res.body.workouts.length).toBe(2);
  });

  it('should return empty array if no workouts today', async () => {
    const res = await request(app)
      .get('/api/workouts/today')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.workouts).toHaveLength(0);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).get('/api/workouts/today');
    expect(res.status).toBe(401);
  });

  it('should not return workouts from other users', async () => {
    const otherUser = await createUser({ email: `other-wt-${Date.now()}@test.com` });
    await createWorkout(otherUser._id, { localDate: TODAY });
    await createWorkout(user._id, { activityType: 'Running', localDate: TODAY });

    const res = await request(app)
      .get('/api/workouts/today')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.workouts.length).toBe(1);
    expect(res.body.workouts[0].activityType).toBe('Running');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/workouts/history', () => {
  it('should return paginated workout history', async () => {
    await createWorkout(user._id, { localDate: '2026-07-05', activityType: 'Cycling' });
    await createWorkout(user._id, { localDate: '2026-07-06', activityType: 'Swimming' });

    const res = await request(app)
      .get('/api/workouts/history')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.workouts)).toBe(true);
  });

  it('should support page parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await createWorkout(user._id, { localDate: `2026-07-0${i + 1}` });
    }

    const res = await request(app)
      .get('/api/workouts/history?page=1&limit=3')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.workouts.length).toBeLessThanOrEqual(3);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).get('/api/workouts/history');
    expect(res.status).toBe(401);
  });
});
