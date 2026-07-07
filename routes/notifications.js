const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const MealLog = require('../models/MealLog');

// Configure web-push VAPID
const rawSubject = process.env.VAPID_EMAIL || process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
const subject = (rawSubject.startsWith('mailto:') || rawSubject.startsWith('http')) 
  ? rawSubject 
  : `mailto:${rawSubject}`;

webpush.setVapidDetails(
  subject,
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

// ── Cron Helper Functions ────────────────────────────────────────────────────
function getCurrentLocalTime(timezone) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: timezone });
  const [hourStr, minuteStr] = timeStr.split(':');
  return {
    hour: parseInt(hourStr, 10),
    minute: parseInt(minuteStr, 10),
    localDate: dateStr
  };
}

function isInWindow(targetHour, targetMinute, currentHour, currentMinute) {
  const targetTotalMins = targetHour * 60 + targetMinute;
  const currentTotalMins = currentHour * 60 + currentMinute;
  return currentTotalMins >= targetTotalMins && currentTotalMins < targetTotalMins + 5;
}

async function hasLoggedInMealPeriod(userId, localDate, timezone, targetHour) {
  const meals = await MealLog.find({ userId, localDate, isDeleted: false });
  if (meals.length === 0) return false;
  let periodStart, periodEnd;
  if (targetHour >= 6 && targetHour < 12) { periodStart = 6; periodEnd = 12; }
  else if (targetHour >= 11 && targetHour < 16) { periodStart = 11; periodEnd = 16; }
  else { periodStart = 16; periodEnd = 24; }

  return meals.some(meal => {
    const mealDate = new Date(meal.loggedAt);
    const mealLocalHourStr = mealDate.toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false
    });
    const mealLocalHour = parseInt(mealLocalHourStr, 10);
    return mealLocalHour >= periodStart && mealLocalHour < periodEnd;
  });
}

async function sendMealReminder(user, mealLabel, balance) {
  const subscription = user.notifications.subscription;
  if (!subscription?.endpoint) return false;

  const balanceText = balance !== null
    ? `$${balance.toFixed(0)} remaining today`
    : 'Log your meal to track your balance';

  const payload = JSON.stringify({
    title: `Time to log your ${mealLabel}! 🍽️`,
    body: balanceText,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    tag: `meal-reminder-${mealLabel.toLowerCase()}`,
    data: { url: '/?tab=log', mealLabel },
    actions: [
      { action: 'log-meal', title: 'Log Now' },
      { action: 'dismiss', title: 'Later' }
    ]
  });

  try {
    await webpush.sendNotification(subscription, payload);
    return true;
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      await User.findByIdAndUpdate(user._id, {
        'notifications.enabled': false,
        'notifications.subscription': null
      });
    }
    return false;
  }
}

// ── POST /api/notifications/cron ───────────────────────────────────────────
// Lightweight endpoint triggered by external cron jobs
router.post('/cron', async (req, res) => {
  if (req.body.token !== 'athlete') {
    return res.status(403).json({ error: 'Unauthorized cron request' });
  }

  const startTime = Date.now();
  try {
    const users = await User.find({
      'notifications.enabled': true,
      'notifications.subscription.endpoint': { $exists: true }
    }).select('name notifications profile');

    let notificationsSent = 0;
    let skipped = 0;

    for (const user of users) {
      const timezone = user.profile?.timezone || 'America/Chicago';
      let localTime;
      try {
        localTime = getCurrentLocalTime(timezone);
      } catch (tzErr) { continue; }

      const { hour, minute, localDate } = localTime;
      const DailyBalance = require('../models/DailyBalance');
      const todayBalance = await DailyBalance.findOne({ userId: user._id, localDate });
      const currentBalance = todayBalance?.currentBalance ?? null;

      for (const notifTime of user.notifications.times) {
        if (!isInWindow(notifTime.hour, notifTime.minute, hour, minute)) continue;

        const lastSentKey = `${notifTime.label}_${localDate}`;
        const lastSent = user.notifications.lastSentAt?.get(lastSentKey);
        if (lastSent) { skipped++; continue; }

        const alreadyLogged = await hasLoggedInMealPeriod(user._id, localDate, timezone, notifTime.hour);
        if (alreadyLogged) { skipped++; continue; }

        const sent = await sendMealReminder(user, notifTime.label, currentBalance);
        if (sent) {
          notificationsSent++;
          if (!user.notifications.lastSentAt) user.notifications.lastSentAt = new Map();
          user.notifications.lastSentAt.set(lastSentKey, new Date().toISOString());
          await user.save();
        }
      }
    }
    const elapsed = Date.now() - startTime;
    res.json({ message: 'Cron completed', elapsedMs: elapsed, notificationsSent, skipped });
  } catch (err) {
    console.error('[CRON] API endpoint error:', err.message);
    res.status(500).json({ error: 'Internal cron error' });
  }
});

module.exports = router;
