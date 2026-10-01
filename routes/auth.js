const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { userId: user._id, employeeId: user.employeeId, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Maps each elevated role to the environment variable holding its invite code.
const INVITE_CODE_ENV_BY_ROLE = {
  admin: 'INVITE_CODE_ADMIN',
  ceo: 'INVITE_CODE_CEO',
  purchasing: 'INVITE_CODE_PURCHASING',
  accounting: 'INVITE_CODE_ACCOUNTING',
};

// POST /api/auth/signup
// 'requester' is open to anyone. Any other role requires the matching invite
// code (set as an environment variable, never stored in code or the database).
router.post('/signup', async (req, res) => {
  try {
    const { employeeId, fullName, password, role, inviteCode } = req.body;

    if (!employeeId || !fullName || !password) {
      return res.status(400).json({ message: 'Employee ID, full name, and password are all required.' });
    }

    const requestedRole = role || 'requester';
    const validRoles = ['requester', 'ceo', 'purchasing', 'accounting', 'admin'];
    if (!validRoles.includes(requestedRole)) {
      return res.status(400).json({ message: 'Invalid role selected.' });
    }

    if (requestedRole !== 'requester') {
      const envVar = INVITE_CODE_ENV_BY_ROLE[requestedRole];
      const correctCode = process.env[envVar];
      if (!correctCode) {
        return res.status(500).json({ message: `No invite code is configured for the "${requestedRole}" role yet.` });
      }
      if (!inviteCode || inviteCode !== correctCode) {
        return res.status(403).json({ message: `Invalid invite code for the "${requestedRole}" role.` });
      }
    }

    const existing = await User.findOne({ employeeId });
    if (existing) {
      return res.status(409).json({ message: 'An account with that Employee ID already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ employeeId, fullName, passwordHash, role: requestedRole });

    const token = signToken(user);

    res.status(201).json({
      message: 'Account created.',
      token,
      user: { employeeId: user.employeeId, fullName: user.fullName, role: user.role },
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Something went wrong creating the account.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { employeeId, password, expectedRole } = req.body;

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

    if (expectedRole && expectedRole !== user.role) {
      return res.status(403).json({
        message: `This account is registered as "${user.role}", not "${expectedRole}". Select the correct role to log in.`,
      });
    }

    const token = signToken(user);

    res.json({
      message: 'Signed in.',
      token,
      user: { employeeId: user.employeeId, fullName: user.fullName, role: user.role },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Something went wrong signing in.' });
  }
});

// PATCH /api/auth/role/:employeeId  — CEO-only: assign a role to another employee
// (requester, ceo, purchasing, accounting). Lets your first CEO account set up the team.
router.patch('/role/:employeeId', requireAuth, requireRole('ceo'), async (req, res) => {
  try {
    const { role } = req.body;
    const validRoles = ['requester', 'ceo', 'purchasing', 'accounting', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: 'Role must be one of: ' + validRoles.join(', ') });
    }

    const user = await User.findOneAndUpdate(
      { employeeId: req.params.employeeId },
      { role },
      { new: true }
    );
    if (!user) {
      return res.status(404).json({ message: 'Employee not found.' });
    }

    res.json({ message: 'Role updated.', user: { employeeId: user.employeeId, fullName: user.fullName, role: user.role } });
  } catch (err) {
    console.error('Role update error:', err);
    res.status(500).json({ message: 'Something went wrong updating the role.' });
  }
});

// POST /api/auth/set-pin — CEO sets or changes their own approval PIN
router.post('/set-pin', requireAuth, requireRole('ceo'), async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || String(pin).length < 4) {
      return res.status(400).json({ message: 'PIN must be at least 4 digits.' });
    }

    const pinHash = await bcrypt.hash(String(pin), 10);
    await User.findByIdAndUpdate(req.user.userId, { pinHash });

    res.json({ message: 'PIN set successfully.' });
  } catch (err) {
    console.error('Set PIN error:', err);
    res.status(500).json({ message: 'Something went wrong setting the PIN.' });
  }
});

module.exports = router;
