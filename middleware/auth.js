const jwt = require('jsonwebtoken');

// Verifies the JWT sent from the frontend and attaches the user info to req.user
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'No token provided. Please sign in again.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { userId, employeeId, role }
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired session. Please sign in again.' });
  }
}

// Restricts a route to specific roles, e.g. requireRole('ceo').
// The 'admin' role always passes, regardless of which roles are listed —
// admins can perform every action in the system.
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(403).json({ message: 'You do not have permission to do that.' });
    }
    if (req.user.role === 'admin' || allowedRoles.includes(req.user.role)) {
      return next();
    }
    return res.status(403).json({ message: 'You do not have permission to do that.' });
  };
}

module.exports = { requireAuth, requireRole };
