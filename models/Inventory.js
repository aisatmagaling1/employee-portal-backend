const mongoose = require('mongoose');

const inventorySchema = new mongoose.Schema(
  {
    itemName: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    quantityAvailable: {
      type: Number,
      required: true,
      default: 0,
    },
    unit: {
      type: String,
      default: 'pcs',
    },
  },
  {
    timestamps: true,
    collection: 'inventory',
  }
);

module.exports = mongoose.model('Inventory', inventorySchema);
