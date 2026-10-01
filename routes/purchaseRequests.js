const express = require('express');
const bcrypt = require('bcryptjs');
const PurchaseRequest = require('../models/PurchaseRequest');
const Inventory = require('../models/Inventory');
const User = require('../models/User');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const ALL_STATUSES = [
  'submitted', 'in_stock_fulfilled', 'pending_ceo_stock_approval', 'rejected_by_ceo_stock',
  'pending_purchasing', 'pending_ceo_purchase_approval', 'rejected_by_ceo_purchase',
  'pending_accounting', 'pending_receipt', 'completed',
];

function addHistory(pr, status, changedBy, note = '') {
  pr.history.push({ status, changedBy, note, at: new Date() });
}

// Admins skip PIN checks entirely — they don't need one to override anything.
async function verifyCeoPin(user, pin) {
  if (user.role === 'admin') return { ok: true };
  const ceo = await User.findById(user.userId);
  if (!ceo || !ceo.pinHash) return { ok: false, reason: 'No PIN has been set for this CEO account yet.' };
  const match = await bcrypt.compare(String(pin || ''), ceo.pinHash);
  if (!match) return { ok: false, reason: 'Incorrect PIN.' };
  return { ok: true };
}

// Admins bypass the "must currently be in status X" guard on every action.
function checkStatus(req, pr, expectedStatus, message) {
  if (req.user.role === 'admin') return null;
  if (pr.status !== expectedStatus) return message;
  return null;
}

// POST /api/purchase-requests — a requester submits a new request.
router.post('/', requireAuth, requireRole('requester', 'ceo'), async (req, res) => {
  try {
    const { itemName, category, quantityRequested, reason } = req.body;
    if (!itemName || !category || !quantityRequested) {
      return res.status(400).json({ message: 'itemName, category, and quantityRequested are required.' });
    }

    const pr = new PurchaseRequest({
      itemName, category, quantityRequested, reason: reason || '',
      requestedBy: req.user.employeeId,
      requesterName: req.body.requesterName || req.user.employeeId,
    });

    const stockItem = await Inventory.findOne({ category, itemName });
    const available = stockItem ? stockItem.quantityAvailable : 0;
    pr.inventoryCheck = {
      quantityAvailableAtCheck: available,
      wasAvailable: available >= quantityRequested,
      checkedAt: new Date(),
    };

    if (available >= quantityRequested) {
      stockItem.quantityAvailable -= quantityRequested;
      await stockItem.save();
      pr.status = 'in_stock_fulfilled';
      addHistory(pr, 'in_stock_fulfilled', req.user.employeeId, 'Fulfilled directly from existing inventory.');
    } else {
      pr.status = 'pending_ceo_stock_approval';
      addHistory(pr, 'pending_ceo_stock_approval', req.user.employeeId, 'Insufficient stock — awaiting CEO approval to purchase.');
    }

    await pr.save();
    res.status(201).json({ message: 'Request submitted.', request: pr });
  } catch (err) {
    console.error('Create purchase request error:', err);
    res.status(500).json({ message: 'Something went wrong submitting the request.' });
  }
});

// GET /api/purchase-requests
router.get('/', requireAuth, async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.mine === 'true') filter.requestedBy = req.user.employeeId;
    const requests = await PurchaseRequest.find(filter).sort({ createdAt: -1 });
    res.json({ requests });
  } catch (err) {
    console.error('List purchase requests error:', err);
    res.status(500).json({ message: 'Could not load requests.' });
  }
});

// GET /api/purchase-requests/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const pr = await PurchaseRequest.findById(req.params.id);
    if (!pr) return res.status(404).json({ message: 'Request not found.' });
    res.json({ request: pr });
  } catch (err) {
    console.error('Get purchase request error:', err);
    res.status(500).json({ message: 'Could not load the request.' });
  }
});

// POST /api/purchase-requests/:id/ceo-approve-stock
router.post('/:id/ceo-approve-stock', requireAuth, requireRole('ceo'), async (req, res) => {
  try {
    const { pin, decision, note } = req.body;
    const pinCheck = await verifyCeoPin(req.user, pin);
    if (!pinCheck.ok) return res.status(401).json({ message: pinCheck.reason });

    const pr = await PurchaseRequest.findById(req.params.id);
    if (!pr) return res.status(404).json({ message: 'Request not found.' });
    const statusErr = checkStatus(req, pr, 'pending_ceo_stock_approval', 'This request is not awaiting stock approval.');
    if (statusErr) return res.status(400).json({ message: statusErr });

    if (decision === 'approve') {
      pr.status = 'pending_purchasing';
      addHistory(pr, 'pending_purchasing', req.user.employeeId, note || 'Approved for purchasing.');
    } else {
      pr.status = 'rejected_by_ceo_stock';
      addHistory(pr, 'rejected_by_ceo_stock', req.user.employeeId, note || 'Rejected.');
    }

    await pr.save();
    res.json({ message: 'Decision recorded.', request: pr });
  } catch (err) {
    console.error('CEO stock approval error:', err);
    res.status(500).json({ message: 'Something went wrong recording the decision.' });
  }
});

// POST /api/purchase-requests/:id/quotations
router.post('/:id/quotations', requireAuth, requireRole('purchasing'), async (req, res) => {
  try {
    const { vendorName, amount, terms } = req.body;
    if (!vendorName || !amount || !terms) {
      return res.status(400).json({ message: 'vendorName, amount, and terms are required.' });
    }

    const pr = await PurchaseRequest.findById(req.params.id);
    if (!pr) return res.status(404).json({ message: 'Request not found.' });
    const statusErr = checkStatus(req, pr, 'pending_purchasing', 'This request is not awaiting purchasing input.');
    if (statusErr) return res.status(400).json({ message: statusErr });

    pr.quotations.push({ vendorName, amount, terms, submittedBy: req.user.employeeId });
    await pr.save();
    res.status(201).json({ message: 'Quotation added.', request: pr });
  } catch (err) {
    console.error('Add quotation error:', err);
    res.status(500).json({ message: 'Something went wrong adding the quotation.' });
  }
});

// POST /api/purchase-requests/:id/submit-quotations
router.post('/:id/submit-quotations', requireAuth, requireRole('purchasing'), async (req, res) => {
  try {
    const pr = await PurchaseRequest.findById(req.params.id);
    if (!pr) return res.status(404).json({ message: 'Request not found.' });
    const statusErr = checkStatus(req, pr, 'pending_purchasing', 'This request is not awaiting purchasing input.');
    if (statusErr) return res.status(400).json({ message: statusErr });
    if (pr.quotations.length === 0) {
      return res.status(400).json({ message: 'Add at least one quotation before submitting.' });
    }

    pr.status = 'pending_ceo_purchase_approval';
    addHistory(pr, 'pending_ceo_purchase_approval', req.user.employeeId, `Submitted ${pr.quotations.length} quotation(s) for approval.`);
    await pr.save();
    res.json({ message: 'Quotations submitted for approval.', request: pr });
  } catch (err) {
    console.error('Submit quotations error:', err);
    res.status(500).json({ message: 'Something went wrong submitting quotations.' });
  }
});

// POST /api/purchase-requests/:id/ceo-approve-purchase
router.post('/:id/ceo-approve-purchase', requireAuth, requireRole('ceo'), async (req, res) => {
  try {
    const { pin, decision, selectedQuotationId, note } = req.body;
    const pinCheck = await verifyCeoPin(req.user, pin);
    if (!pinCheck.ok) return res.status(401).json({ message: pinCheck.reason });

    const pr = await PurchaseRequest.findById(req.params.id);
    if (!pr) return res.status(404).json({ message: 'Request not found.' });
    const statusErr = checkStatus(req, pr, 'pending_ceo_purchase_approval', 'This request is not awaiting purchase approval.');
    if (statusErr) return res.status(400).json({ message: statusErr });

    if (decision === 'approve') {
      if (selectedQuotationId) {
        pr.quotations.forEach((q) => { q.selected = String(q._id) === String(selectedQuotationId); });
      } else if (req.user.role === 'admin' && pr.quotations.length === 0) {
        // Admin override with no quotations on file — proceed anyway, nothing to select.
      } else if (!pr.quotations.some((q) => q.selected)) {
        return res.status(400).json({ message: 'Select which quotation to approve.' });
      }
      pr.status = 'pending_accounting';
      addHistory(pr, 'pending_accounting', req.user.employeeId, note || 'Purchase approved.');
    } else {
      pr.status = 'rejected_by_ceo_purchase';
      addHistory(pr, 'rejected_by_ceo_purchase', req.user.employeeId, note || 'Rejected.');
    }

    await pr.save();
    res.json({ message: 'Decision recorded.', request: pr });
  } catch (err) {
    console.error('CEO purchase approval error:', err);
    res.status(500).json({ message: 'Something went wrong recording the decision.' });
  }
});

// POST /api/purchase-requests/:id/accounting-process
router.post('/:id/accounting-process', requireAuth, requireRole('accounting'), async (req, res) => {
  try {
    const { amountPaid, note } = req.body;
    const pr = await PurchaseRequest.findById(req.params.id);
    if (!pr) return res.status(404).json({ message: 'Request not found.' });
    const statusErr = checkStatus(req, pr, 'pending_accounting', 'This request is not awaiting accounting.');
    if (statusErr) return res.status(400).json({ message: statusErr });

    pr.accounting = {
      processedBy: req.user.employeeId,
      processedAt: new Date(),
      amountPaid: amountPaid || null,
      note: note || '',
    };
    pr.status = 'pending_receipt';
    addHistory(pr, 'pending_receipt', req.user.employeeId, 'Payment processed — awaiting item receipt.');
    await pr.save();
    res.json({ message: 'Marked as processed.', request: pr });
  } catch (err) {
    console.error('Accounting process error:', err);
    res.status(500).json({ message: 'Something went wrong processing accounting.' });
  }
});

// POST /api/purchase-requests/:id/mark-received
router.post('/:id/mark-received', requireAuth, requireRole('purchasing'), async (req, res) => {
  try {
    const { note } = req.body;
    const pr = await PurchaseRequest.findById(req.params.id);
    if (!pr) return res.status(404).json({ message: 'Request not found.' });
    const statusErr = checkStatus(req, pr, 'pending_receipt', 'This request is not awaiting receipt.');
    if (statusErr) return res.status(400).json({ message: statusErr });

    pr.receivedConfirmation = { receivedBy: req.user.employeeId, receivedAt: new Date(), note: note || '' };
    pr.status = 'completed';
    addHistory(pr, 'completed', req.user.employeeId, 'Item received — request complete.');
    await pr.save();
    res.json({ message: 'Request marked complete.', request: pr });
  } catch (err) {
    console.error('Mark received error:', err);
    res.status(500).json({ message: 'Something went wrong marking receipt.' });
  }
});

// POST /api/purchase-requests/:id/admin-override — admin-only: jump straight to any
// status, bypassing the normal step-by-step flow entirely.
router.post('/:id/admin-override', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { newStatus, note } = req.body;
    if (!ALL_STATUSES.includes(newStatus)) {
      return res.status(400).json({ message: 'Invalid status value.' });
    }

    const pr = await PurchaseRequest.findById(req.params.id);
    if (!pr) return res.status(404).json({ message: 'Request not found.' });

    pr.status = newStatus;
    addHistory(pr, newStatus, req.user.employeeId, note || 'Status changed directly by admin.');
    await pr.save();
    res.json({ message: 'Status overridden.', request: pr });
  } catch (err) {
    console.error('Admin override error:', err);
    res.status(500).json({ message: 'Something went wrong overriding the status.' });
  }
});

module.exports = router;
