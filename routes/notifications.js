const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const MealLog = require('../models/MealLog');

// Configure web-push VAPID
webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ── GET /api/notifications/vapid-public-key ─────────────────────────────────
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// ── POST /api/notifications/subscribe ──────────────────────────────────────
router.post('/subscribe', requireAuth, async (req, res) => {
  try {
    const { subscription, timezone } = req.body;

    if (!subscription?.endpoint || !subscription?.keys) {
      return res.status(400).json({ error: 'Invalid push subscription' });
    }

    const user = req.user;
    user.notifications.subscription = subscription;
    user.notifications.enabled = true;

    // Update timezone if provided
    if (timezone && user.profile) {
      user.profile.timezone = timezone;
    }

    await user.save();

    // Send a test welcome notification
    try {
      await webpush.sendNotification(subscription, JSON.stringify({
        title: 'Athlon Notifications Active 💪',
        body: `You're all set, ${user.name}! I'll remind you to log your meals.`,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/badge-72x72.png',
        tag: 'welcome'
      }));
    } catch (notifErr) {
      console.error('[NOTIFICATIONS] Welcome notification failed:', notifErr.message);
    }

    res.json({ message: 'Subscribed to notifications successfully' });
  } catch (err) {
    console.error('[NOTIFICATIONS] Subscribe error:', err.message);
    res.status(500).json({ error: 'Failed to subscribe to notifications.' });
  }
});

// ── POST /api/notifications/unsubscribe ────────────────────────────────────
router.post('/unsubscribe', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    user.notifications.enabled = false;
    user.notifications.subscription = undefined;
    await user.save();
    res.json({ message: 'Unsubscribed from notifications' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unsubscribe.' });
  }
});

// ── GET /api/notifications/settings ────────────────────────────────────────
router.get('/settings', requireAuth, (req, res) => {
  const { enabled, times } = req.user.notifications;
  res.json({ enabled, times });
});

// ── PUT /api/notifications/settings ────────────────────────────────────────
router.put('/settings', requireAuth, async (req, res) => {
  try {
    const { times } = req.body;
    const user = req.user;

    if (times && Array.isArray(times)) {
      user.notifications.times = times;
    }

    await user.save();
    res.json({ message: 'Notification settings updated', times: user.notifications.times });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update notification settings.' });
  }
});

// ── POST /api/notifications/send-test ──────────────────────────────────────
router.post('/send-test', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.notifications?.enabled || !user.notifications?.subscription) {
      return res.status(400).json({ error: 'Notifications not enabled' });
    }

    await webpush.sendNotification(user.notifications.subscription, JSON.stringify({
      title: 'Test Notification 🔔',
      body: 'Athlon notifications are working!',
      icon: '/icons/icon-192x192.png',
      tag: 'test'
    }));

    res.json({ message: 'Test notification sent' });
  } catch (err) {
    console.error('[NOTIFICATIONS] Test error:', err.message);
    res.status(500).json({ error: 'Failed to send test notification.' });
  }
});

module.exports = router;
