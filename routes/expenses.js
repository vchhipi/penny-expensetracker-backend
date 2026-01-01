const express = require("express");
const router = express.Router();
const db = require("../config/db");
const verifyToken = require("../middleware/authMiddleware");

/* =========================
   GET USER EXPENSES (JWT)
========================= */
router.get("/expenses", verifyToken, (req, res) => {
  const userId = req.userId;

  const sql = "SELECT * FROM expenses WHERE user_id = ?";

  db.query(sql, [userId], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json(results);
  });
});

module.exports = router;
s