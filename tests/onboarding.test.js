/**
 * tests/onboarding.test.js
 * Tests for /api/onboarding/chat and /api/onboarding/status endpoints.
 */

const request = require('supertest');
jest.mock('../utils/groq');

const { buildApp, createUser, authHeader } = require('./helpers');
const { agentChat, parseAIJson } = require('../utils/groq');
const User = require('../models/User');

let app, user;

beforeAll(() => {
  app = buildApp();
});

beforeEach(async () => {
  // Create a user who has NOT completed onboarding
  user = await createUser({
    email:              `onboard-${Date.now()}@test.com`,
    onboardingComplete: false,
    profile:            {}
  });

  // Default mock: AI responds with conversational message (not completion JSON)
  agentChat.mockResolvedValue("What's your age?");
  parseAIJson.mockImplementation((text) => {
    try { return JSON.parse(text); } catch { return null; }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/onboarding/status', () => {
  it('should return not complete for unfinished user', async () => {
    const res = await request(app)
      .get('/api/onboarding/status')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.complete).toBe(false);
  });

  it('should return complete for onboarded user', async () => {
    const onboarded = await createUser({ email: `done-${Date.now()}@test.com`, onboardingComplete: true });

    const res = await request(app)
      .get('/api/onboarding/status')
      .set(authHeader(onboarded));

    expect(res.status).toBe(200);
    expect(res.body.complete).toBe(true);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).get('/api/onboarding/status');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/onboarding/chat', () => {
  it('should return a conversational response when onboarding is incomplete', async () => {
    agentChat.mockResolvedValueOnce('Great! How old are you?');
    parseAIJson.mockReturnValueOnce(null);

    const res = await request(app)
      .post('/api/onboarding/chat')
      .set(authHeader(user))
      .send({ message: 'Hi, I just signed up!' });

    expect(res.status).toBe(200);
    expect(res.body.complete).toBe(false);
    expect(res.body.message).toBe('Great! How old are you?');
  });

  it('should save message history to user record', async () => {
    agentChat.mockResolvedValueOnce('How old are you?');
    parseAIJson.mockReturnValueOnce(null);

    await request(app)
      .post('/api/onboarding/chat')
      .set(authHeader(user))
      .send({ message: 'My name is Alice' });

    const updatedUser = await User.findById(user._id);
    const msgs = updatedUser.onboardingMessages;
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.some(m => m.content === 'My name is Alice')).toBe(true);
  });

  it('should complete onboarding when AI returns completion JSON', async () => {
    const completionData = {
      complete: true,
      data: {
        age:           25,
        weight:        70,
        height:        175,
        sex:           'male',
        activityLevel: 'moderate',
        goal:          'lose',
        timezone:      'America/Chicago',
        unitSystem:    'metric',
        notificationTimes: [
          { hour: 10, minute: 0, label: 'Breakfast' },
          { hour: 13, minute: 0, label: 'Lunch'     },
          { hour: 20, minute: 0, label: 'Dinner'    }
        ]
      }
    };

    agentChat.mockResolvedValueOnce(`\`\`\`json\n${JSON.stringify(completionData)}\n\`\`\``);
    parseAIJson.mockReturnValueOnce(completionData);

    const res = await request(app)
      .post('/api/onboarding/chat')
      .set(authHeader(user))
      .send({ message: 'That is everything!' });

    expect(res.status).toBe(200);
    expect(res.body.complete).toBe(true);
    expect(res.body.tdee).toBeDefined();
    expect(res.body.user.onboardingComplete).toBe(true);
    expect(res.body.user.profile.age).toBe(25);
    expect(res.body.user.profile.goal).toBe('lose');

    // Verify DB
    const dbUser = await User.findById(user._id);
    expect(dbUser.onboardingComplete).toBe(true);
    expect(dbUser.profile.tdee).toBeDefined();
    expect(dbUser.profile.timezone).toBe('America/Chicago');
  });

  it('should respond with "already complete" when onboarding is done', async () => {
    const onboarded = await createUser({ email: `already-done-${Date.now()}@test.com` });

    const res = await request(app)
      .post('/api/onboarding/chat')
      .set(authHeader(onboarded))
      .send({ message: 'Hello again' });

    expect(res.status).toBe(200);
    expect(res.body.complete).toBe(true);
    expect(res.body.message).toMatch(/already complete/i);
  });

  it('should start conversation without a message (initial greeting)', async () => {
    agentChat.mockResolvedValueOnce('Welcome to Athlon! Let\'s set up your profile.');
    parseAIJson.mockReturnValueOnce(null);

    const res = await request(app)
      .post('/api/onboarding/chat')
      .set(authHeader(user))
      .send({});  // no message

    expect(res.status).toBe(200);
    expect(res.body.complete).toBe(false);
    expect(res.body.message).toBeDefined();
  });

  it('should return 500 when AI throws an error', async () => {
    agentChat.mockRejectedValueOnce(new Error('AI failure'));

    const res = await request(app)
      .post('/api/onboarding/chat')
      .set(authHeader(user))
      .send({ message: 'Test' });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to process/i);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/onboarding/chat')
      .send({ message: 'Hello' });

    expect(res.status).toBe(401);
  });

  it('should calculate and save TDEE after completion', async () => {
    const completionData = {
      complete: true,
      data: {
        age: 30, weight: 80, height: 180,
        sex: 'male', activityLevel: 'active', goal: 'maintain',
        timezone: 'America/New_York', unitSystem: 'metric',
        notificationTimes: [
          { hour: 8, minute: 0, label: 'Breakfast' },
          { hour: 12, minute: 0, label: 'Lunch' },
          { hour: 19, minute: 0, label: 'Dinner' }
        ]
      }
    };

    agentChat.mockResolvedValueOnce(JSON.stringify(completionData));
    parseAIJson.mockReturnValueOnce(completionData);

    const res = await request(app)
      .post('/api/onboarding/chat')
      .set(authHeader(user))
      .send({ message: 'Done!' });

    expect(res.status).toBe(200);
    const tdee = res.body.tdee;
    expect(tdee).toBeGreaterThan(2000);
    expect(tdee).toBeLessThan(5000);
  });
});
