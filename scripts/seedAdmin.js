// One-time setup script: creates the very first Admin account directly in
// the database, bypassing sign-up entirely (per design, Admin is never
// self-registered). Run this once, locally or via Render's Shell tab:
//
//   node scripts/seedAdmin.js
//
// Reads everything from environment variables so no secrets are hardcoded.
// Requires these to be set (locally in your .env, or in Render's Shell
// environment, which already has your other env vars loaded):
//   MONGODB_URI
//   SEED_ADMIN_EMPLOYEE_ID
//   SEED_ADMIN_FIRST_NAME
//   SEED_ADMIN_LAST_NAME
//   SEED_ADMIN_PASSWORD

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

async function run() {
  const {
    MONGODB_URI,
    SEED_ADMIN_EMPLOYEE_ID,
    SEED_ADMIN_FIRST_NAME,
    SEED_ADMIN_LAST_NAME,
    SEED_ADMIN_PASSWORD,
  } = process.env;

  const missing = ['MONGODB_URI', 'SEED_ADMIN_EMPLOYEE_ID', 'SEED_ADMIN_FIRST_NAME', 'SEED_ADMIN_LAST_NAME', 'SEED_ADMIN_PASSWORD']
    .filter((key) => !process.env[key]);
  if (missing.length) {
    console.error('Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB Atlas.');

  const existing = await User.findOne({ employeeId: SEED_ADMIN_EMPLOYEE_ID });
  if (existing) {
    existing.role = 'admin';
    await existing.save();
    console.log(`Existing account "${SEED_ADMIN_EMPLOYEE_ID}" was promoted to admin.`);
  } else {
    const passwordHash = await bcrypt.hash(SEED_ADMIN_PASSWORD, 10);
    await User.create({
      employeeId: SEED_ADMIN_EMPLOYEE_ID,
      firstName: SEED_ADMIN_FIRST_NAME,
      lastName: SEED_ADMIN_LAST_NAME,
      passwordHash,
      role: 'admin',
    });
    console.log(`Created new admin account "${SEED_ADMIN_EMPLOYEE_ID}".`);
  }

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch((err) => {
  console.error('Seed script failed:', err);
  process.exit(1);
});
