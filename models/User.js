const mongoose = require('mongoose');

// Final role list. 'role' is intentionally NOT validated with a schema-level
// enum so that `null` (no role yet) is always a legal value — role values are
// validated in application code (see middleware/auth.js ROLES list) instead.
const userSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
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
      default: null, // no role until an Admin/CEO assigns one
    },
  },
  {
    timestamps: true,
    collection: 'usersinfo', // matches the collection you already created in Atlas
  }
);

module.exports = mongoose.model('User', userSchema);
