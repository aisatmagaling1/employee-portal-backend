const express = require('express');
const Inventory = require('../models/Inventory');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/inventory — anyone logged in can view stock
router.get('/', requireAuth, async (req, res) => {
  try {
    const items = await Inventory.find().sort({ category: 1, itemName: 1 });
    res.json({ items });
  } catch (err) {
    console.error('Inventory list error:', err);
    res.status(500).json({ message: 'Could not load inventory.' });
  }
});

// POST /api/inventory — purchasing or ceo can add new inventory items
router.post('/', requireAuth, requireRole('purchasing', 'ceo'), async (req, res) => {
  try {
    const { itemName, category, quantityAvailable, unit } = req.body;
    if (!itemName || !category || quantityAvailable === undefined) {
      return res.status(400).json({ message: 'itemName, category, and quantityAvailable are required.' });
    }
    const item = await Inventory.create({ itemName, category, quantityAvailable, unit: unit || 'pcs' });
    res.status(201).json({ message: 'Item added.', item });
  } catch (err) {
    console.error('Inventory create error:', err);
    res.status(500).json({ message: 'Could not add item.' });
  }
});

// PATCH /api/inventory/:id — adjust stock count (e.g. after purchasing receives new stock)
router.patch('/:id', requireAuth, requireRole('purchasing', 'ceo'), async (req, res) => {
  try {
    const { quantityAvailable } = req.body;
    const item = await Inventory.findByIdAndUpdate(
      req.params.id,
      { quantityAvailable },
      { new: true }
    );
    if (!item) return res.status(404).json({ message: 'Item not found.' });
    res.json({ message: 'Stock updated.', item });
  } catch (err) {
    console.error('Inventory update error:', err);
    res.status(500).json({ message: 'Could not update item.' });
  }
});

module.exports = router;
