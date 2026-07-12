const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const pushSubscriptionSchema = new mongoose.Schema({
  endpoint: String,
  keys: {
    p256dh: String,
    auth: String
  },
  appCommitId: String,
  // Tracks which server version we last sent an update notification for.
  // Replaces the old `updateNotified` boolean so each new deploy fires exactly once.
  notifiedVersion: { type: String, default: null }
}, { _id: false });

const notificationTimeSchema = new mongoose.Schema({
  hour: { type: Number, required: true },   // 0-23 local hour
  minute: { type: Number, default: 0 },
  label: { type: String, default: 'Meal' }  // 'Breakfast', 'Lunch', 'Dinner'
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6 },

  // Body stats
  profile: {
    age: Number,
    weight: Number,       // kg
    height: Number,       // cm
    sex: { type: String, enum: ['male', 'female', 'other'] },
    activityLevel: {
      type: String,
      enum: ['sedentary', 'light', 'moderate', 'active', 'very_active'],
      default: 'moderate'
    },
    goal: { type: String, enum: ['lose', 'maintain', 'gain'], default: 'maintain' },
    tdee: Number,           // calculated TDEE in kcal
    timezone: { type: String, default: 'America/Chicago' },
    unitSystem: { type: String, enum: ['metric', 'imperial'], default: 'metric' }
  },

  // Notification settings
  notifications: {
    enabled: { type: Boolean, default: false },
    subscription: pushSubscriptionSchema,
    times: {
      type: [notificationTimeSchema],
      default: [
        { hour: 10, minute: 0, label: 'Breakfast' },
        { hour: 13, minute: 0, label: 'Lunch' },
        { hour: 20, minute: 0, label: 'Dinner' }
      ]
    },
    lastSentAt: { type: Map, of: String }  // label -> ISO date of last notification
  },

  // Onboarding state
  onboardingComplete: { type: Boolean, default: false },
  onboardingMessages: [{
    role: { type: String, enum: ['user', 'assistant'] },
    content: String,
    timestamp: { type: Date, default: Date.now }
  }],

  isVerified: { type: Boolean, default: false },

  theme: { type: String, enum: ['dark', 'light'], default: 'dark' },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Hash password before save
userSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

// Compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Calculate TDEE using Mifflin-St Jeor
userSchema.methods.calculateTDEE = function() {
  const { age, weight, height, sex, activityLevel, goal } = this.profile;
  if (!age || !weight || !height || !sex) return null;

  let bmr;
  if (sex === 'male') {
    bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  } else {
    bmr = 10 * weight + 6.25 * height - 5 * age - 161;
  }

  const multipliers = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9
  };

  let tdee = bmr * (multipliers[activityLevel] || 1.55);

  // Adjust for goal
  if (goal === 'lose') tdee -= 500;
  else if (goal === 'gain') tdee += 300;

  return Math.round(tdee);
};

module.exports = mongoose.model('User', userSchema);
