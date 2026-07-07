const mongoose = require('mongoose');

const ingredientSchema = new mongoose.Schema({
  name: { type: String, required: true },
  amount: { type: Number, required: true },  // grams
  unit: { type: String, default: 'g' },
  calories: { type: Number, required: true },
  protein: { type: Number, default: 0 },
  carbs: { type: Number, default: 0 },
  fat: { type: Number, default: 0 },
  usdaId: String,
  usdaDescription: String,
  verified: { type: Boolean, default: true }
}, { _id: false });

const mealLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true },
  logType: { type: String, enum: ['ai_name', 'ai_image', 'manual'], required: true },
  imageUrl: String,             // base64 or path if uploaded via image
  ingredients: [ingredientSchema],

  // Totals
  totalCalories: { type: Number, required: true },
  totalProtein: { type: Number, default: 0 },
  totalCarbs: { type: Number, default: 0 },
  totalFat: { type: Number, default: 0 },

  // AI verification
  aiVerdict: String,            // Agent's sanity-check verdict
  confidenceNote: String,

  // Edit/deletion tracking
  editHistory: [{
    editedAt: { type: Date, default: Date.now },
    previousCalories: Number,
    reason: String,
    ptApproved: { type: Boolean, default: false },
    ptNote: String
  }],
  isDeleted: { type: Boolean, default: false },
  deletedAt: Date,
  deleteReason: String,
  ptDeleteApproved: { type: Boolean, default: false },

  // Date tracking (local date string for timezone-aware grouping)
  localDate: { type: String, required: true },  // 'YYYY-MM-DD' in user's timezone

  loggedAt: { type: Date, default: Date.now }
}, { timestamps: true });

mealLogSchema.index({ userId: 1, localDate: 1 });
mealLogSchema.index({ userId: 1, loggedAt: -1 });

module.exports = mongoose.model('MealLog', mealLogSchema);
