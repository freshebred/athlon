const DailyBalance = require('../models/DailyBalance');
const User = require('../models/User');

/**
 * Get or create today's balance record for a user
 */
async function getTodayBalance(userId, localDate) {
  let balance = await DailyBalance.findOne({ userId, localDate });
  
  if (!balance) {
    const user = await User.findById(userId);
    const tdee = user.profile?.tdee || user.calculateTDEE() || 2000;
    
    // Get previous day's closing balance for carryover
    const yesterday = getPreviousDate(localDate);
    const prevBalance = await DailyBalance.findOne({ userId, localDate: yesterday });
    
    let carryover = 0;
    if (prevBalance && !prevBalance.closed) {
      // Close previous day
      prevBalance.closed = true;
      prevBalance.closedAt = new Date();
      prevBalance.closingBalance = prevBalance.currentBalance;
      await prevBalance.save();
      
      // If negative, carry debt forward; if positive, reset (expires)
      if (prevBalance.closingBalance < 0) {
        carryover = prevBalance.closingBalance; // negative debt
      }
    } else if (prevBalance?.closingBalance < 0) {
      carryover = prevBalance.closingBalance;
    }
    
    balance = new DailyBalance({
      userId,
      localDate,
      openingBalance: tdee,
      carryover,
      caloriesConsumed: 0,
      caloriesBurnt: 0,
      currentBalance: tdee + carryover
    });
    await balance.save();
  }
  
  return balance;
}

/**
 * Update balance after logging a meal
 */
async function deductMealCalories(userId, localDate, calories) {
  const balance = await getTodayBalance(userId, localDate);
  balance.caloriesConsumed += calories;
  balance.currentBalance = balance.openingBalance + balance.carryover - balance.caloriesConsumed + balance.caloriesBurnt;
  balance.updatedAt = new Date();
  await balance.save();
  return balance;
}

/**
 * Update balance after logging a workout
 */
async function addWorkoutCalories(userId, localDate, calories) {
  const balance = await getTodayBalance(userId, localDate);
  balance.caloriesBurnt += calories;
  balance.currentBalance = balance.openingBalance + balance.carryover - balance.caloriesConsumed + balance.caloriesBurnt;
  balance.updatedAt = new Date();
  await balance.save();
  return balance;
}

/**
 * Reverse a meal deduction (for edits/deletions)
 */
async function reverseDeduction(userId, localDate, calories) {
  const balance = await DailyBalance.findOne({ userId, localDate });
  if (balance) {
    balance.caloriesConsumed = Math.max(0, balance.caloriesConsumed - calories);
    balance.currentBalance = balance.openingBalance + balance.carryover - balance.caloriesConsumed + balance.caloriesBurnt;
    balance.updatedAt = new Date();
    await balance.save();
  }
  return balance;
}

/**
 * Reverse a workout deduction (for edits/deletions)
 */
async function reverseWorkoutCalories(userId, localDate, calories) {
  const balance = await DailyBalance.findOne({ userId, localDate });
  if (balance) {
    balance.caloriesBurnt = Math.max(0, balance.caloriesBurnt - calories);
    balance.currentBalance = balance.openingBalance + balance.carryover - balance.caloriesConsumed + balance.caloriesBurnt;
    balance.updatedAt = new Date();
    await balance.save();
  }
  return balance;
}

/**
 * Get local date string from timezone
 */
function getLocalDate(timezone) {
  const now = new Date();
  const options = { timeZone: timezone || 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' };
  const parts = new Intl.DateTimeFormat('en-CA', options).formatToParts(now);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function getPreviousDate(localDate) {
  const d = new Date(localDate + 'T12:00:00Z');
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

module.exports = { getTodayBalance, deductMealCalories, addWorkoutCalories, reverseDeduction, reverseWorkoutCalories, getLocalDate };
