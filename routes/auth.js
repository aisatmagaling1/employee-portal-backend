const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { employeeId, fullName, password } = req.body;

    if (!employeeId || !fullName || !password) {
      return res.status(400).json({ message: 'Employee ID, full name, and password are all required.' });
    }

    const existing = await User.findOne({ employeeId });
    if (existing) {
      return res.status(409).json({ message: 'An account with that Employee ID already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ employeeId, fullName, passwordHash });

    const token = jwt.sign(
      { userId: user._id, employeeId: user.employeeId },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Account created.',
      token,
      user: { employeeId: user.employeeId, fullName: user.fullName },
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Something went wrong creating the account.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { employeeId, password } = req.body;

    if (!employeeId || !password) {
      return res.status(400).json({ message: 'Employee ID and password are required.' });
    }

    const user = await User.findOne({ employeeId });
    if (!user) {
      return res.status(401).json({ message: 'Invalid employee ID or password.' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ message: 'Invalid employee ID or password.' });
    }

    const token = jwt.sign(
      { userId: user._id, employeeId: user.employeeId },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Signed in.',
      token,
      user: { employeeId: user.employeeId, fullName: user.fullName },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Something went wrong signing in.' });
  }
});

module.exports = router;
