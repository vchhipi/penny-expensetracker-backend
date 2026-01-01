const jwt = require("jsonwebtoken");

const JWT_SECRET = "mysecretkey"; // same as login

const verifyToken = (req, res, next) => {
  // 1. Get token from header
  const authHeader = req.headers["authorization"];

  if (!authHeader) {
    return res.status(401).json({ message: "No token provided" });
  }

  // Format: "Bearer TOKEN"
  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Invalid token format" });
  }

  // 2. Verify token
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }

    // 3. Attach userId to request
    req.userId = decoded.userId;

    next(); // allow access
  });
};

module.exports = verifyToken;
