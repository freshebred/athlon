#!/usr/bin/env node
/**
 * Athlon Notification Cron Script
 * 
 * This script is designed to be run every 5 minutes via a system cron job:
 * 
 *   * /5 * * * * cd /path/to/tracker && node cron-notify.js >> /var/log/athlon-cron.log 2>&1
 * 
 * Logic:
 * 1. Fetch all users with notifications enabled
 * 2. For each user, determine their current local time
 * 3. Check if any of their notification times fall within the current 5-minute window
 * 4. If yes, check if they've already logged a meal in that meal window today
 * 5. If they haven't logged, send a push notification
 * 6. Track last sent time to prevent duplicate notifications
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');
const webpush = require('web-push');

// Configure VAPID
const rawSubject = process.env.VAPID_EMAIL || process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
const subject = (rawSubject.startsWith('mailto:') || rawSubject.startsWith('http')) 
  ? rawSubject 
  : `mailto:${rawSubject}`;

webpush.setVapidDetails(
  subject,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// Models (inline schema to avoid circular deps)
const User = require('./models/User');
const MealLog = require('./models/MealLog');

/**
 * Get the current hour and minute in a given IANA timezone
 * @param {string} timezone - IANA timezone string
 * @returns {{ hour: number, minute: number, localDate: string }}
 */
function getCurrentLocalTime(timezone) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD

  const [hourStr, minuteStr] = timeStr.split(':');
  return {
    hour: parseInt(hourStr, 10),
    minute: parseInt(minuteStr, 10),
    localDate: dateStr
  };
}

/**
 * Check if a notification time falls within the current 5-minute window
 * @param {number} targetHour - The notification hour (0-23)
 * @param {number} targetMinute - The notification minute (0-59)
 * @param {number} currentHour - Current local hour
 * @param {number} currentMinute - Current local minute
 * @returns {boolean}
 */
function isInWindow(targetHour, targetMinute, currentHour, currentMinute) {
  const targetTotalMins = targetHour * 60 + targetMinute;
  const currentTotalMins = currentHour * 60 + currentMinute;
  // Check if current time is within [targetTime, targetTime + 5min)
  return currentTotalMins >= targetTotalMins && currentTotalMins < targetTotalMins + 5;
}

/**
 * Check if user has already logged a meal around a given time window today
 * Uses a 2-hour window around the notification time to check for logs
 */
async function hasLoggedAroundTime(userId, localDate, targetHour) {
  const startHour = Math.max(0, targetHour - 1);
  const endHour = Math.min(23, targetHour + 1);

  // Get all meals logged today
  const meals = await MealLog.find({
    userId,
    localDate,
    isDeleted: false
  });

  // Check if any meal was logged within 1 hour of notification time
  return meals.some(meal => {
    const mealHour = new Date(meal.loggedAt).getHours(); // UTC hour
    // This is a simplified check - ideally convert to user local time
    // For cron purposes, we check if any meal exists within +/- 1 hour UTC
    return meals.length > 0; // Simple: if any meal logged today near this time
  });

  // Better implementation: check meal count per day portion
  // Morning (5am-12pm), Afternoon (12pm-5pm), Evening (5pm-midnight)
}

/**
 * Better check: has user logged within the meal period?
 * Breakfast: 5am-11:59am, Lunch: 11am-4pm, Dinner: 4pm-11:59pm
 */
async function hasLoggedInMealPeriod(userId, localDate, timezone, targetHour) {
  const meals = await MealLog.find({ userId, localDate, isDeleted: false });
  if (meals.length === 0) return false;

  // Define meal periods (local hour ranges)
  let periodStart, periodEnd;
  if (targetHour >= 6 && targetHour < 12) {
    // Breakfast
    periodStart = 6; periodEnd = 12;
  } else if (targetHour >= 11 && targetHour < 16) {
    // Lunch
    periodStart = 11; periodEnd = 16;
  } else {
    // Dinner (or custom time)
    periodStart = 16; periodEnd = 24;
  }

  // Check if any meal was logged in this period (approximate - using UTC hours)
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

/**
 * Send a push notification to a user
 */
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
    data: {
      url: '/?tab=log',
      mealLabel
    },
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
      // Subscription expired — disable for this user
      console.log(`[CRON] Subscription expired for user ${user._id}, disabling notifications`);
      await User.findByIdAndUpdate(user._id, {
        'notifications.enabled': false,
        'notifications.subscription': null
      });
    } else {
      console.error(`[CRON] Failed to send to user ${user._id}:`, err.message);
    }
    return false;
  }
}

/**
 * Main cron function
 */
async function runCron() {
  const startTime = Date.now();
  console.log(`[CRON] Starting notification run at ${new Date().toISOString()}`);

  try {
    await mongoose.connect(process.env.DB_URI);

    // Fetch users with notifications enabled and a valid subscription
    const users = await User.find({
      'notifications.enabled': true,
      'notifications.subscription.endpoint': { $exists: true }
    }).select('name notifications profile');

    console.log(`[CRON] Found ${users.length} users with notifications enabled`);

    let notificationsSent = 0;
    let skipped = 0;

    for (const user of users) {
      const timezone = user.profile?.timezone || 'America/Chicago';

      let localTime;
      try {
        localTime = getCurrentLocalTime(timezone);
      } catch (tzErr) {
        console.error(`[CRON] Invalid timezone for user ${user._id}: ${timezone}`);
        continue;
      }

      const { hour, minute, localDate } = localTime;

      // Get today's balance for the notification message
      const DailyBalance = require('./models/DailyBalance');
      const todayBalance = await DailyBalance.findOne({ userId: user._id, localDate });
      const currentBalance = todayBalance?.currentBalance ?? null;

      // Check each notification time
      for (const notifTime of user.notifications.times) {
        if (!isInWindow(notifTime.hour, notifTime.minute, hour, minute)) {
          continue;
        }

        // Check last sent time for this label (prevent duplicate sends in same 5-min window)
        const lastSentKey = `${notifTime.label}_${localDate}`;
        const lastSent = user.notifications.lastSentAt?.get(lastSentKey);
        if (lastSent) {
          console.log(`[CRON] Already sent ${notifTime.label} notification to user ${user._id} today`);
          skipped++;
          continue;
        }

        // Check if they've already logged a meal in this period
        const alreadyLogged = await hasLoggedInMealPeriod(user._id, localDate, timezone, notifTime.hour);
        if (alreadyLogged) {
          console.log(`[CRON] User ${user._id} already logged for ${notifTime.label}, skipping`);
          skipped++;
          continue;
        }

        // Send the notification
        const sent = await sendMealReminder(user, notifTime.label, currentBalance);
        if (sent) {
          console.log(`[CRON] ✓ Sent ${notifTime.label} reminder to ${user.name} (${user._id})`);
          notificationsSent++;

          // Record that we sent this notification
          if (!user.notifications.lastSentAt) {
            user.notifications.lastSentAt = new Map();
          }
          user.notifications.lastSentAt.set(lastSentKey, new Date().toISOString());
          await user.save();
        }
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[CRON] Done in ${elapsed}ms | Sent: ${notificationsSent} | Skipped: ${skipped}`);
  } catch (err) {
    console.error('[CRON] Fatal error:', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

runCron();
