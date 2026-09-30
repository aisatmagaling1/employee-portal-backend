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

// Restricts a route to specific roles, e.g. requireRole('ceo')
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to do that.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
