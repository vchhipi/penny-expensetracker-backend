const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");

// test route to confirm router is loading
router.get("/test", (req, res) => {
  res.json({ message: "Auth route working" });
});

// register route
router.post("/register", authController.register);

module.exports = router;

