const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['requester', 'ceo', 'purchasing', 'accounting'],
      default: 'requester',
    },
    pinHash: {
      type: String, // only used for role: 'ceo' — hashed PIN for approvals
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'usersinfo', // matches the collection you already created in Atlas
  }
);

module.exports = mongoose.model('User', userSchema);
