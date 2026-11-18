const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, sparse: true },
  phone: { type: String, unique: true, sparse: true },
  password: { type: String, required: true },
  profilePhoto: { type: String, default: 'https://unsplash.com' },
  resetOtp: { type: String },
  resetOtpExpiry: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
