const mongoose = require('mongoose');

const scheduledCheckInSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  message: { type: String, required: true },
  scheduledFor: { type: Date, required: true, index: true },
  status: { type: String, enum: ['pending', 'sent', 'cancelled'], default: 'pending' },
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'PTConversation' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ScheduledCheckIn', scheduledCheckInSchema);
