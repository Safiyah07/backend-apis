// middleware/auth.js
const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");

/**
 * Auth middleware that verifies token and optionally checks user roles
 * @param {Array} allowedRoles - Optional array of allowed roles (e.g., ['admin', 'teacher'])
 */
const authMiddleware = (allowedRoles = []) =>
  asyncHandler(async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ message: "Not authorized, no token provided" });
    }

    const token = authHeader.split(" ")[1];

    try {
      const decoded = jwt.verify(token, process.env.ACCESS_SECRET);
      req.user = decoded;

      // Optional role-based access check
      if (allowedRoles.length && !allowedRoles.includes(decoded.role)) {
        return res
          .status(403)
          .json({ message: "Forbidden: insufficient permissions" });
      }

      next();
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res
          .status(401)
          .json({ message: "Token expired", expired: true });
      }
      return res.status(403).json({ message: "Not authorized, invalid token" });
    }
  });

module.exports = { authMiddleware };
