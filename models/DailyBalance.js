const mongoose = require('mongoose');

// Tracks the daily calorie balance for each user
const dailyBalanceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  localDate: { type: String, required: true },  // 'YYYY-MM-DD'

  // Starting balance (TDEE in kcal = $ balance)
  openingBalance: { type: Number, required: true },   // TDEE for that day
  carryover: { type: Number, default: 0 },            // from previous day (negative = debt)

  // Running totals
  caloriesConsumed: { type: Number, default: 0 },     // total kcal eaten
  caloriesBurnt: { type: Number, default: 0 },        // total kcal from workouts

  // Computed: openingBalance + carryover - caloriesConsumed + caloriesBurnt
  currentBalance: { type: Number, default: 0 },

  // End-of-day snapshot
  closed: { type: Boolean, default: false },
  closedAt: Date,
  closingBalance: Number,

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

dailyBalanceSchema.index({ userId: 1, localDate: 1 }, { unique: true });

module.exports = mongoose.model('DailyBalance', dailyBalanceSchema);
