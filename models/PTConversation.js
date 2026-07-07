const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant', 'tool', 'system'], required: true },
  content: { type: String, required: false },
  tool_calls: { type: mongoose.Schema.Types.Mixed }, // [{ id, type, function: { name, arguments } }]
  tool_call_id: { type: String }, // Used for role: 'tool' to map to the call
  name: { type: String }, // Name of the tool called
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

const ptConversationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  // Context of conversation
  context: {
    type: { type: String, enum: ['dispute_workout', 'dispute_meal', 'coaching', 'general'] },
    referenceId: mongoose.Schema.Types.ObjectId,  // WorkoutLog or MealLog _id
    referenceType: { type: String, enum: ['WorkoutLog', 'MealLog'] },
    initialClaim: String,   // What the user is disputing / initial message
  },

  messages: [messageSchema],

  // Resolution
  resolved: { type: Boolean, default: false },
  resolution: {
    outcome: { type: String, enum: ['user_accepted', 'pt_adjusted', 'no_change', 'ongoing'] },
    caloriesAdjusted: Number,
    note: String,
    resolvedAt: Date
  },

  // Persistent memory note (stored for future PT context)
  memoryNote: {
    summary: String,      // Brief summary for future PT sessions
    createdAt: { type: Date, default: Date.now }
  },

  sessionStartedAt: { type: Date, default: Date.now },
  lastMessageAt: { type: Date, default: Date.now }
}, { timestamps: true });

ptConversationSchema.index({ userId: 1, lastMessageAt: -1 });

module.exports = mongoose.model('PTConversation', ptConversationSchema);
