// Migration 001: remove the PIN column entirely.
//
// MongoDB is schemaless, so deleting `pinHash` from models/User.js only stops
// NEW writes from including it — it does NOT remove the field from documents
// that already have it. This script does that removal explicitly.
//
// Run once:
//   node scripts/migrations/001-remove-pin.js

require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error('Missing MONGODB_URI environment variable.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB Atlas.');

  const result = await mongoose.connection.collection('usersinfo').updateMany(
    { pinHash: { $exists: true } },
    { $unset: { pinHash: '' } }
  );

  console.log(`Removed pinHash from ${result.modifiedCount} document(s).`);

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
