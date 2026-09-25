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
  },
  {
    timestamps: true,
    collection: 'usersinfo', // matches the collection you already created in Atlas
  }
);

module.exports = mongoose.model('User', userSchema);
