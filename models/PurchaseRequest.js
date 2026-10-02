const mongoose = require('mongoose');

const quotationSchema = new mongoose.Schema(
  {
    vendorName: { type: String, required: true, trim: true },
    amount: { type: Number, required: true },
    terms: { type: String, required: true, trim: true },
    submittedBy: { type: String, required: true }, // employeeId of purchasing staff
    submittedAt: { type: Date, default: Date.now },
    selected: { type: Boolean, default: false },
  },
  { _id: true }
);

const historyEntrySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    changedBy: { type: String, required: true }, // employeeId
    note: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const purchaseRequestSchema = new mongoose.Schema(
  {
    itemName: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    quantityRequested: { type: Number, required: true },
    reason: { type: String, default: '' },

    requestedBy: { type: String, required: true }, // employeeId
    requesterName: { type: String, required: true },

    status: {
      type: String,
      enum: [
        'submitted',
        'in_stock_fulfilled',
        'pending_ceo_stock_approval',
        'rejected_by_ceo_stock',
        'pending_purchasing',
        'pending_ceo_purchase_approval',
        'rejected_by_ceo_purchase',
        'pending_accounting',
        'pending_receipt',
        'completed',
      ],
      default: 'submitted',
    },

    inventoryCheck: {
      quantityAvailableAtCheck: { type: Number, default: null },
      wasAvailable: { type: Boolean, default: null },
      checkedAt: { type: Date, default: null },
    },

    quotations: [quotationSchema],

    accounting: {
      processedBy: { type: String, default: null },
      processedAt: { type: Date, default: null },
      amountPaid: { type: Number, default: null },
      note: { type: String, default: '' },
    },

    receivedConfirmation: {
      receivedBy: { type: String, default: null },
      receivedAt: { type: Date, default: null },
      note: { type: String, default: '' },
    },

    history: [historyEntrySchema],
  },
  {
    timestamps: true,
    collection: 'purchaserequests',
  }
);

module.exports = mongoose.model('PurchaseRequest', purchaseRequestSchema);
