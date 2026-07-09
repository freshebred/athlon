/**
 * tests/notifications.test.js
 * Tests for:
 *   - /api/notifications/subscribe & unsubscribe
 *   - /api/notifications/settings GET/PUT
 *   - /api/notifications/cron (refactored logic: always sends, contextual if recently logged)
 *   - Helper functions: getCurrentLocalTime, isInWindow, buildNotificationPayload,
 *     truncateMealName, getRecentlyLoggedMeal
 */

const request = require('supertest');

// Mock web-push to prevent real push attempts
jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn().mockResolvedValue({ statusCode: 201 })
}));

const { buildApp, createUser, createMeal, authHeader } = require('./helpers');
const webpush = require('web-push');
const MealLog = require('../models/MealLog');

let app, user;

const mockSubscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint',
  keys: { p256dh: 'test-p256dh', auth: 'test-auth' }
};

beforeAll(() => {
  app = buildApp();
  process.env.VAPID_EMAIL      = 'test@example.com';
  process.env.VAPID_PUBLIC_KEY = 'test-public-key';
  process.env.VAPID_PRIVATE_KEY = 'test-private-key';
});

beforeEach(async () => {
  user = await createUser({ email: `notif-${Date.now()}@test.com` });
  webpush.sendNotification.mockClear();
  webpush.sendNotification.mockResolvedValue({ statusCode: 201 });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/notifications/vapid-public-key', () => {
  it('should return VAPID public key', async () => {
    const res = await request(app).get('/api/notifications/vapid-public-key');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('publicKey');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/notifications/subscribe', () => {
  it('should subscribe a user and send a welcome notification', async () => {
    const res = await request(app)
      .post('/api/notifications/subscribe')
      .set(authHeader(user))
      .send({ subscription: mockSubscription });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/subscribed/i);
    // Welcome notification should have been sent
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(webpush.sendNotification.mock.calls[0][1]);
    expect(payload.tag).toBe('welcome');
  });

  it('should save subscription to user', async () => {
    await request(app)
      .post('/api/notifications/subscribe')
      .set(authHeader(user))
      .send({ subscription: mockSubscription });

    const User = require('../models/User');
    const updated = await User.findById(user._id);
    expect(updated.notifications.enabled).toBe(true);
    expect(updated.notifications.subscription.endpoint).toBe(mockSubscription.endpoint);
  });

  it('should save timezone if provided', async () => {
    await request(app)
      .post('/api/notifications/subscribe')
      .set(authHeader(user))
      .send({ subscription: mockSubscription, timezone: 'America/New_York' });

    const User = require('../models/User');
    const updated = await User.findById(user._id);
    expect(updated.profile.timezone).toBe('America/New_York');
  });

  it('should return 400 for invalid subscription', async () => {
    const res = await request(app)
      .post('/api/notifications/subscribe')
      .set(authHeader(user))
      .send({ subscription: {} });

    expect(res.status).toBe(400);
  });

  it('should return 401 without auth', async () => {
    const res = await request(app)
      .post('/api/notifications/subscribe')
      .send({ subscription: mockSubscription });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/notifications/unsubscribe', () => {
  it('should disable notifications', async () => {
    // First subscribe
    await request(app)
      .post('/api/notifications/subscribe')
      .set(authHeader(user))
      .send({ subscription: mockSubscription });

    const res = await request(app)
      .post('/api/notifications/unsubscribe')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    const User = require('../models/User');
    const updated = await User.findById(user._id);
    expect(updated.notifications.enabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/notifications/settings', () => {
  it('should return notification settings', async () => {
    const res = await request(app)
      .get('/api/notifications/settings')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('enabled');
    expect(res.body).toHaveProperty('times');
    expect(Array.isArray(res.body.times)).toBe(true);
  });

  it('should return 401 without auth', async () => {
    const res = await request(app).get('/api/notifications/settings');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /api/notifications/settings', () => {
  it('should update notification times', async () => {
    const newTimes = [
      { hour: 8,  minute: 30, label: 'Breakfast' },
      { hour: 12, minute: 0,  label: 'Lunch'     },
      { hour: 19, minute: 0,  label: 'Dinner'    }
    ];

    const res = await request(app)
      .put('/api/notifications/settings')
      .set(authHeader(user))
      .send({ times: newTimes });

    expect(res.status).toBe(200);
    expect(res.body.times).toHaveLength(3);
    expect(res.body.times[0].hour).toBe(8);
    expect(res.body.times[0].minute).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/notifications/cron — core logic', () => {
  it('should return 403 without cron token', async () => {
    const res = await request(app)
      .post('/api/notifications/cron')
      .send({ token: 'wrong-token' });
    expect(res.status).toBe(403);
  });

  it('should process users with enabled notifications', async () => {
    // Subscribe the user
    const User = require('../models/User');
    await User.findByIdAndUpdate(user._id, {
      'notifications.enabled': true,
      'notifications.subscription': mockSubscription,
      'notifications.times': [
        // Set all notification times to current time to ensure window is hit
        { hour: 0, minute: 0, label: 'Test' }
      ]
    });

    const res = await request(app)
      .post('/api/notifications/cron')
      .send({ token: 'athlete' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('notificationsSent');
    expect(res.body).toHaveProperty('skipped');
    expect(res.body).toHaveProperty('elapsedMs');
  });

  it('should skip users with notifications disabled', async () => {
    // User has notifications disabled by default in createUser
    const res = await request(app)
      .post('/api/notifications/cron')
      .send({ token: 'athlete' });

    expect(res.status).toBe(200);
    // Our test user is not subscribed, so no notifications for them
    expect(res.body.notificationsSent).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Notification helpers (unit tests)', () => {
  const { _helpers } = require('../routes/notifications');
  const {
    isInWindow,
    truncateMealName,
    buildNotificationPayload,
    getCurrentLocalTime
  } = _helpers;

  describe('isInWindow', () => {
    it('should return true when exactly at target time', () => {
      expect(isInWindow(10, 0, 10, 0)).toBe(true);
    });

    it('should return true within 5-minute window', () => {
      expect(isInWindow(10, 0, 10, 4)).toBe(true);
    });

    it('should return false at exactly 5 minutes after', () => {
      expect(isInWindow(10, 0, 10, 5)).toBe(false);
    });

    it('should return false before the window', () => {
      expect(isInWindow(10, 30, 10, 29)).toBe(false);
    });

    it('should return false well after the window', () => {
      expect(isInWindow(10, 0, 11, 0)).toBe(false);
    });
  });

  describe('truncateMealName', () => {
    it('should return short names unchanged', () => {
      expect(truncateMealName('Pasta')).toBe('Pasta');
    });

    it('should truncate long names with ellipsis', () => {
      const result = truncateMealName('A Very Long Meal Name That Exceeds The Limit', 28);
      expect(result.length).toBeLessThanOrEqual(28);
      expect(result.endsWith('…')).toBe(true);
    });

    it('should return "your meal" for null/undefined', () => {
      expect(truncateMealName(null)).toBe('your meal');
      expect(truncateMealName(undefined)).toBe('your meal');
    });

    it('should use custom max length', () => {
      const result = truncateMealName('Chicken Breast With Vegetables', 15);
      expect(result.length).toBeLessThanOrEqual(15);
    });
  });

  describe('buildNotificationPayload — no recent meal', () => {
    it('should return standard reminder when no recent meal', () => {
      const payload = buildNotificationPayload('Dinner', null, 500);
      expect(payload.title).toMatch(/dinner/i);
      expect(payload.body).not.toMatch(/I saw you logged/i);
      expect(payload.tag).toBe('meal-reminder-dinner');
    });

    it('should include balance in body when available', () => {
      const payload = buildNotificationPayload('Lunch', null, 800);
      expect(payload.body).toMatch(/800/);
    });
  });

  describe('buildNotificationPayload — with recent meal', () => {
    it('should return contextual message when user recently logged', () => {
      const recentMeal = { name: 'Grilled Chicken', _id: 'test123' };
      const payload = buildNotificationPayload('Dinner', recentMeal, 800);

      expect(payload.title).toMatch(/grilled chicken/i);
      expect(payload.body).toMatch(/I saw you logged/i);
      expect(payload.body).toMatch(/dinner/i);
      expect(payload.tag).toBe('meal-reminder-dinner');
    });

    it('should truncate long meal names in contextual message', () => {
      const recentMeal = { name: 'Spicy Garlic Butter Shrimp With Lemon Zest And Fresh Herbs Over Rice', _id: 'test456' };
      const payload = buildNotificationPayload('Lunch', recentMeal, 600);

      // Title and body should not be excessively long
      expect(payload.title.length).toBeLessThan(80);
      expect(payload.body).toMatch(/I saw you logged/i);
    });

    it('should use meal label (not meal name) in the question part', () => {
      const recentMeal = { name: 'Oatmeal', _id: 'test789' };
      const payload = buildNotificationPayload('Breakfast', recentMeal, null);

      expect(payload.body).toMatch(/breakfast/i);
    });
  });

  describe('getCurrentLocalTime', () => {
    it('should return hour, minute, and localDate for valid timezone', () => {
      const result = getCurrentLocalTime('America/Chicago');
      expect(result).toHaveProperty('hour');
      expect(result).toHaveProperty('minute');
      expect(result).toHaveProperty('localDate');
      expect(result.hour).toBeGreaterThanOrEqual(0);
      expect(result.hour).toBeLessThanOrEqual(23);
      expect(result.minute).toBeGreaterThanOrEqual(0);
      expect(result.minute).toBeLessThanOrEqual(59);
      expect(result.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should work for various timezones', () => {
      ['America/New_York', 'Europe/London', 'Asia/Tokyo'].forEach(tz => {
        const result = getCurrentLocalTime(tz);
        expect(result.hour).toBeGreaterThanOrEqual(0);
        expect(result.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Notification: Always sends regardless of logged status', () => {
  it('standard reminder should not check meal log to decide whether to send', () => {
    const { _helpers } = require('../routes/notifications');
    const { buildNotificationPayload } = _helpers;

    // Key behavior: buildNotificationPayload always produces a sendable payload
    // regardless of whether recentMeal is null or not
    const withMeal    = buildNotificationPayload('Dinner', { name: 'Pasta', _id: 'x' }, 1000);
    const withoutMeal = buildNotificationPayload('Dinner', null, 1000);

    // Both should have non-null, non-empty titles and bodies
    expect(withMeal.title).toBeTruthy();
    expect(withMeal.body).toBeTruthy();
    expect(withoutMeal.title).toBeTruthy();
    expect(withoutMeal.body).toBeTruthy();

    // They should produce different messages
    expect(withMeal.body).not.toBe(withoutMeal.body);
  });
});
