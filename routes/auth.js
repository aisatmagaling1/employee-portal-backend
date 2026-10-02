const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { requireAuth, requireRole, ROLES } = require('../middleware/auth');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { userId: user._id, employeeId: user.employeeId, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function fullName(user) {
  return `${user.firstName} ${user.lastName}`.trim();
}

// POST /api/auth/signup
// A new account always starts with NO role, unless the "Register as CEO"
// checkbox was used with a valid invite code — that's the only self-service
// elevated role. Every other role (Supervisor, Purchasing, Accounting,
// Employee) is assigned later by an Admin or CEO. The first Admin account
// is never created through this endpoint — see scripts/seedAdmin.js.
router.post('/signup', async (req, res) => {
  try {
    const { employeeId, firstName, lastName, password, registerAsCeo, inviteCode } = req.body;

    if (!employeeId || !firstName || !lastName || !password) {
      return res.status(400).json({ message: 'First name, last name, Employee ID, and password are all required.' });
    }

    let role = null;
    if (registerAsCeo) {
      const correctCode = process.env.INVITE_CODE_CEO;
      if (!correctCode) {
        return res.status(500).json({ message: 'No CEO invite code is configured yet.' });
      }
      if (!inviteCode || inviteCode !== correctCode) {
        return res.status(403).json({ message: 'Invalid CEO invite code.' });
      }
      role = 'ceo';
    }

    const existing = await User.findOne({ employeeId });
    if (existing) {
      return res.status(409).json({ message: 'An account with that Employee ID already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ employeeId, firstName, lastName, passwordHash, role });

    // A brand new account with no role can't log in yet (see /login below),
    // so we don't hand back a token for a role-less signup — only for CEO.
    if (!role) {
      return res.status(201).json({
        message: 'Account created. Your account is awaiting role assignment before you can sign in.',
      });
    }

    const token = signToken(user);
    res.status(201).json({
      message: 'Account created.',
      token,
      user: { employeeId: user.employeeId, firstName: user.firstName, lastName: user.lastName, role: user.role },
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Something went wrong creating the account.' });
  }
});

// POST /api/auth/login
// Employee ID + password only. No role is accepted or trusted from the
// client — the account's actual stored role decides everything. An account
// with no role assigned yet is blocked here, server-side, not just in the UI.
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

    if (!user.role) {
      return res.status(403).json({ message: 'Your account is awaiting role assignment.' });
    }

    const token = signToken(user);
    res.json({
      message: 'Signed in.',
      token,
      user: { employeeId: user.employeeId, firstName: user.firstName, lastName: user.lastName, role: user.role },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Something went wrong signing in.' });
  }
});

// PATCH /api/auth/role/:employeeId — Admin or CEO only: assign/change a role.
// Enforced here via requireRole, not just by hiding UI buttons.
router.patch('/role/:employeeId', requireAuth, requireRole('ceo'), async (req, res) => {
  try {
    const { role } = req.body;
    if (role !== null && !ROLES.includes(role)) {
      return res.status(400).json({ message: 'Role must be one of: ' + ROLES.join(', ') + ', or null to unassign.' });
    }

    const user = await User.findOneAndUpdate(
      { employeeId: req.params.employeeId },
      { role },
      { new: true }
    );
    if (!user) {
      return res.status(404).json({ message: 'Employee not found.' });
    }

    res.json({
      message: 'Role updated.',
      user: { employeeId: user.employeeId, firstName: user.firstName, lastName: user.lastName, role: user.role },
    });
  } catch (err) {
    console.error('Role update error:', err);
    res.status(500).json({ message: 'Something went wrong updating the role.' });
  }
});

// GET /api/auth/users — Admin or CEO only: list everyone, for the Manage Roles page.
router.get('/users', requireAuth, requireRole('ceo'), async (req, res) => {
  try {
    const users = await User.find().select('employeeId firstName lastName role').sort({ createdAt: -1 });
    res.json({ users });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ message: 'Could not load the employee list.' });
  }
});

module.exports = router;
