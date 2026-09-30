const express = require('express');
const bcrypt = require('bcryptjs');
const PurchaseRequest = require('../models/PurchaseRequest');
const Inventory = require('../models/Inventory');
const User = require('../models/User');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function addHistory(pr, status, changedBy, note = '') {
  pr.history.push({ status, changedBy, note, at: new Date() });
}

async function verifyCeoPin(userId, pin) {
  const ceo = await User.findById(userId);
  if (!ceo || !ceo.pinHash) return { ok: false, reason: 'No PIN has been set for this CEO account yet.' };
  const match = await bcrypt.compare(String(pin || ''), ceo.pinHash);
  if (!match) return { ok: false, reason: 'Incorrect PIN.' };
  return { ok: true };
}

// POST /api/purchase-requests — a requester submits a new request.
// Automatically checks inventory: if enough stock exists, it's fulfilled immediately;
// otherwise it goes to the CEO for approval to proceed with purchasing.
router.post('/', requireAuth, requireRole('requester', 'ceo'), async (req, res) => {
  try {
    const { itemName, category, quantityRequested, reason } = req.body;
    if (!itemName || !category || !quantityRequested) {
      return res.status(400).json({ message: 'itemName, category, and quantityRequested are required.' });
    }

    const pr = new PurchaseRequest({
      itemName,
      category,
      quantityRequested,
      reason: reason || '',
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

// GET /api/purchase-requests — list requests, optionally filtered by status or "mine"
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
// CEO approves or rejects proceeding to purchasing when stock was insufficient.
router.post('/:id/ceo-approve-stock', requireAuth, requireRole('ceo'), async (req, res) => {
  try {
    const { pin, decision, note } = req.body;
    const pinCheck = await verifyCeoPin(req.user.userId, pin);
    if (!pinCheck.ok) return res.status(401).json({ message: pinCheck.reason });

    const pr = await PurchaseRequest.findById(req.params.id);
    if (!pr) return res.status(404).json({ message: 'Request not found.' });
    if (pr.status !== 'pending_ceo_stock_approval') {
      return res.status(400).json({ message: 'This request is not awaiting stock approval.' });
    }

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

// POST /api/purchase-requests/:id/quotations — purchasing adds a quotation/terms option.
// Can be called multiple times to attach several vendor quotations to one request.
router.post('/:id/quotations', requireAuth, requireRole('purchasing'), async (req, res) => {
  try {
    const { vendorName, amount, terms } = req.body;
    if (!vendorName || !amount || !terms) {
      return res.status(400).json({ message: 'vendorName, amount, and terms are required.' });
    }

    const pr = await PurchaseRequest.findById(req.params.id);
    if (!pr) return res.status(404).json({ message: 'Request not found.' });
    if (pr.status !== 'pending_purchasing') {
      return res.status(400).json({ message: 'This request is not awaiting purchasing input.' });
    }

    pr.quotations.push({ vendorName, amount, terms, submittedBy: req.user.employeeId });
    await pr.save();
    res.status(201).json({ message: 'Quotation added.', request: pr });
  } catch (err) {
    console.error('Add quotation error:', err);
    res.status(500).json({ message: 'Something went wrong adding the quotation.' });
  }
});

// POST /api/purchase-requests/:id/submit-quotations — purchasing sends all added
// quotations to the CEO for approval.
router.post('/:id/submit-quotations', requireAuth, requireRole('purchasing'), async (req, res) => {
  try {
    const pr = await PurchaseRequest.findById(req.params.id);
    if (!pr) return res.status(404).json({ message: 'Request not found.' });
    if (pr.status !== 'pending_purchasing') {
      return res.status(400).json({ message: 'This request is not awaiting purchasing input.' });
    }
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
// CEO picks a quotation and approves, or rejects the whole batch.
router.post('/:id/ceo-approve-purchase', requireAuth, requireRole('ceo'), async (req, res) => {
  try {
    const { pin, decision, selectedQuotationId, note } = req.body;
    const pinCheck = await verifyCeoPin(req.user.userId, pin);
    if (!pinCheck.ok) return res.status(401).json({ message: pinCheck.reason });

    const pr = await PurchaseRequest.findById(req.params.id);
    if (!pr) return res.status(404).json({ message: 'Request not found.' });
    if (pr.status !== 'pending_ceo_purchase_approval') {
      return res.status(400).json({ message: 'This request is not awaiting purchase approval.' });
    }

    if (decision === 'approve') {
      if (!selectedQuotationId) {
        return res.status(400).json({ message: 'Select which quotation to approve.' });
      }
      pr.quotations.forEach((q) => {
        q.selected = String(q._id) === String(selectedQuotationId);
      });
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
    if (pr.status !== 'pending_accounting') {
      return res.status(400).json({ message: 'This request is not awaiting accounting.' });
    }

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

// POST /api/purchase-requests/:id/mark-received — purchasing confirms the item arrived,
// completing the request.
router.post('/:id/mark-received', requireAuth, requireRole('purchasing'), async (req, res) => {
  try {
    const { note } = req.body;
    const pr = await PurchaseRequest.findById(req.params.id);
    if (!pr) return res.status(404).json({ message: 'Request not found.' });
    if (pr.status !== 'pending_receipt') {
      return res.status(400).json({ message: 'This request is not awaiting receipt.' });
    }

    pr.receivedConfirmation = {
      receivedBy: req.user.employeeId,
      receivedAt: new Date(),
      note: note || '',
    };
    pr.status = 'completed';
    addHistory(pr, 'completed', req.user.employeeId, 'Item received — request complete.');
    await pr.save();
    res.json({ message: 'Request marked complete.', request: pr });
  } catch (err) {
    console.error('Mark received error:', err);
    res.status(500).json({ message: 'Something went wrong marking receipt.' });
  }
});

module.exports = router;
