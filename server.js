// =========================
// IMPORTS

// =========================
const cors = require("cors");

const express = require("express");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// =========================
// APP & CONSTANTS
// =========================
const app = express();
const JWT_SECRET = "mysecretkey"; // move to .env later

app.use(express.json());
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);


// =========================
// DATABASE CONNECTION
// =========================
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "Vaishali1@", // your MySQL password
  database: "expense_tracker",
});

db.connect(() => console.log("✅ MySQL Connected"));

// =========================
// JWT VERIFY MIDDLEWARE
// =========================
const verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader) {
    return res.status(401).json({ message: "No token provided" });
  }

  // Expected: Bearer TOKEN
  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Invalid token format" });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }

    req.userId = decoded.userId; // attach userId
    next();
  });
};

// =========================
// TEST ROUTE
// =========================
app.get("/", (req, res) => {
  res.send("SERVER OK");
});

// =========================
// REGISTER API
// =========================
app.post("/register", (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "All fields required" });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);

  const sql =
    "INSERT INTO users (name, email, password) VALUES (?, ?, ?)";

  db.query(sql, [name, email, hashedPassword], (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.status(201).json({
      message: "User registered successfully",
    });
  });
});

// =========================
// LOGIN API (JWT)
// =========================
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password required" });
  }

  const sql = "SELECT * FROM users WHERE email = ?";

  db.query(sql, [email], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (results.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = results[0];
    const isMatch = bcrypt.compareSync(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: user.id },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({
      message: "Login successful",
      token,
    });
  });
});

// =========================
// ADD EXPENSE (JWT PROTECTED)
// =========================
app.post("/expenses", verifyToken, (req, res) => {
  const userId = req.userId;
  const { title, amount, category, expense_date } = req.body;

  if (!title || !amount || !category || !expense_date) {
    return res.status(400).json({ message: "All fields required" });
  }

  // 🔥 ADD THIS LOG
  console.log(
    "🧾 Expense received:",
    { userId, title, amount, category, expense_date }
  );

  const sql = `
    INSERT INTO expenses (user_id, title, amount, category, expense_date)
    VALUES (?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [userId, title, amount, category, expense_date],
    (err) => {
      if (err) {
        console.error("❌ DB error:", err);
        return res.status(500).json({ error: err.message });
      }

      console.log("✅ Expense saved to DB for user:", userId);

      res.status(201).json({ message: "Expense added successfully" });
    }
  );
});


// =========================
// GET USER EXPENSES (JWT PROTECTED)
// =========================
app.get("/expenses", verifyToken, (req, res) => {
  const userId = req.userId;

  const sql = "SELECT * FROM expenses WHERE user_id = ?";

  db.query(sql, [userId], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json(results);
  });
});
/* =========================
   CATEGORY-WISE SUMMARY (JWT)
========================= */
app.get("/expenses/category-summary", verifyToken, (req, res) => {
  const userId = req.userId;

  const sql = `
    SELECT category, SUM(amount) AS total
    FROM expenses
    WHERE user_id = ?
    GROUP BY category
  `;

  db.query(sql, [userId], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json(results);
  });
});


/* =========================
   DELETE EXPENSE (JWT)
========================= */
app.delete("/expenses/:id", verifyToken, (req, res) => {
  const userId = req.userId;
  const expenseId = req.params.id;

  console.log("🗑 DELETE REQUEST RECEIVED");
  console.log("User:", userId);
  console.log("Expense ID:", expenseId);

  const sql = `
    DELETE FROM expenses
    WHERE id = ? AND user_id = ?
  `;

  db.query(sql, [expenseId, userId], (err, result) => {
    if (err) {
      console.error("❌ DELETE DB ERROR:", err);
      return res.status(500).json({ error: err.message });
    }

    if (result.affectedRows === 0) {
      console.warn("⚠️ Expense not found or not authorized");
      return res.status(404).json({ message: "Not found" });
    }

    console.log("✅ Expense deleted from DB");
    res.json({ message: "Expense deleted successfully" });
  });
});

// app.delete("/expenses/:id", verifyToken, (req, res) => {
//   const userId = req.userId;
//   const expenseId = req.params.id;

//   const sql = `
//     DELETE FROM expenses
//     WHERE id = ? AND user_id = ?
//   `;

//   db.query(sql, [expenseId, userId], (err, result) => {
//     if (err) {
//       return res.status(500).json({ error: err.message });
//     }

//     if (result.affectedRows === 0) {
//       return res.status(404).json({
//         message: "Expense not found or not authorized",
//       });
//     }

//     res.json({ message: "Expense deleted successfully" });
//   });
// });

/* =========================
   UPDATE EXPENSE (JWT)
========================= */
app.put("/expenses/:id", verifyToken, (req, res) => {
  const userId = req.userId;
  const expenseId = req.params.id;
  const { title, amount, category, expense_date } = req.body;

  if (!title || !amount || !category || !expense_date) {
    return res.status(400).json({ message: "All fields required" });
  }

  const sql = `
    UPDATE expenses
    SET title = ?, amount = ?, category = ?, expense_date = ?
    WHERE id = ? AND user_id = ?
  `;

  db.query(
    sql,
    [title, amount, category, expense_date, expenseId, userId],
    (err, result) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({
          message: "Expense not found or not authorized",
        });
      }

      res.json({ message: "Expense updated successfully" });
    }
  );
});

/* =========================
   MONTHLY EXPENSE SUMMARY (JWT)
========================= */
app.get("/expenses/monthly-summary", verifyToken, (req, res) => {
  const userId = req.userId;

  const sql = `
    SELECT 
      MONTH(expense_date) AS month,
      SUM(amount) AS total
    FROM expenses
    WHERE user_id = ?
    GROUP BY MONTH(expense_date)
    ORDER BY month
  `;

  db.query(sql, [userId], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json(results);
  });
});

// =========================
// START SERVER
// =========================
app.listen(4000, () => {
  console.log("🚀 Server running on http://localhost:4000");
});
