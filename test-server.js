console.log("🔥🔥🔥 FINAL TEST SERVER 🔥🔥🔥");

const express = require("express");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");

const app = express();
app.use(express.json());

const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "Vaishali1@",
  database: "expense_tracker",
});

db.connect(() => console.log("✅ MySQL Connected"));

/* ---------- TEST ---------- */
app.get("/ping", (req, res) => {
  res.json({ message: "PING OK" });
});

/* ---------- REGISTER ---------- */
app.post("/register", (req, res) => {
  res.json({ message: "REGISTER HIT" });
});

/* ---------- LOGIN ---------- */
app.post("/login", (req, res) => {
  res.json({ message: "LOGIN HIT" });
});

app.get("/ping", (req, res) => {
    res.json({ message: "PING OK" });
  });
  

/* ---------- START ---------- */
app.listen(4000, () => {
  console.log("🚀 Server running on http://127.0.0.1:4000");
});
