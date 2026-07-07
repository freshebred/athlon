const mongoose = require('mongoose');

const workoutLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  // Workout details
  activityType: { type: String, required: true },   // 'Running', 'Weightlifting', etc.
  duration: { type: Number, required: true },        // minutes
  intensity: { type: String, enum: ['low', 'moderate', 'high', 'extreme'], default: 'moderate' },
  description: String,                               // user's description of workout

  // AI image verification
  imageVerified: { type: Boolean, default: false },
  aiImageVerdict: String,
  imageBase64: String,

  // Calorie calculation
  rawCaloriesBurnt: Number,          // AI estimate before 10% reduction
  caloriesBurnt: { type: Number, required: true },  // after 10% reduction

  // PT dispute
  ptDisputed: { type: Boolean, default: false },
  ptAdjustment: Number,              // calories added/removed after PT conversation
  ptConversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'PTConversation' },
  finalCaloriesBurnt: Number,        // caloriesBurnt + ptAdjustment (if any)

  localDate: { type: String, required: true },
  loggedAt: { type: Date, default: Date.now }
}, { timestamps: true });

workoutLogSchema.index({ userId: 1, localDate: 1 });

module.exports = mongoose.model('WorkoutLog', workoutLogSchema);
