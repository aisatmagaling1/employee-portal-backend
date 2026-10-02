const jwt = require('jsonwebtoken');

// The complete, final role list. Keep this as the single source of truth —
// every other file that needs to know what roles exist should reference this.
const ROLES = ['admin', 'ceo', 'supervisor', 'purchasing', 'accounting', 'employee'];

// Admin and CEO have full access everywhere, including every approval and
// edit action, regardless of which specific roles a route lists.
const FULL_ACCESS_ROLES = ['admin', 'ceo'];

// Verifies the JWT and attaches { userId, employeeId, role } to req.user.
// Also enforces, on every single protected call (not just at login), that
// the account actually has a role — defense in depth in case an old token
// from before this system existed is ever replayed.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'No token provided. Please sign in again.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload.role) {
      return res.status(403).json({ message: 'Your account is awaiting role assignment.' });
    }
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired session. Please sign in again.' });
  }
}

// Restricts a route to specific roles, e.g. requireRole('purchasing').
// Admin and CEO always pass, regardless of which roles are listed.
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(403).json({ message: 'You do not have permission to do that.' });
    }
    if (FULL_ACCESS_ROLES.includes(req.user.role) || allowedRoles.includes(req.user.role)) {
      return next();
    }
    return res.status(403).json({ message: 'You do not have permission to do that.' });
  };
}

module.exports = { requireAuth, requireRole, ROLES, FULL_ACCESS_ROLES };
