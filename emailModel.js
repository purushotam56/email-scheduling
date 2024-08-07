const mongoose = require('mongoose');

const emailSchema = new mongoose.Schema({
  recipients: [String],
  subject: String,
  email_text: String,
  scheduledTime: Date,
  status: {
    type: String,
    enum: ['scheduled', 'sent', 'failed'],
    default: 'scheduled',
  },
});

module.exports = mongoose.model('Email', emailSchema);
