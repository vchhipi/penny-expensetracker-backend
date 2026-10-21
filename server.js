
// =========================
// IMPORTS & CONFIG
// =========================
require("dotenv").config();
const { parseExpense } = require("./gemini");
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("JWT_SECRET is not set. Add it to your .env file.");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
// app.use(cors({
//   origin: ["http://localhost:5174", "http://127.0.0.1:5174"],
//   credentials: true
// }));

// =========================
// DATABASE POOL
// =========================
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
  ssl:
    process.env.DB_SSL === "true"
      ? {
          rejectUnauthorized: true,
          ca: process.env.DB_SSL_CA?.replace(/\\n/g, "\n"),
        }
      : undefined,
});

pool
  .query("SELECT 1")
  .then(() => console.log("MySQL connected"))
  .catch((err) => console.error("MySQL connection failed:", err.message));

// =========================
// HELPERS
// =========================
const isDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value));

const toAmount = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 10000000) return null;
  return Math.round(n * 100) / 100;
};

const cleanText = (value, max) => String(value ?? "").trim().slice(0, max);

// =========================
// JWT VERIFY MIDDLEWARE
// =========================
function verifyToken(req, res, next) {
  const [scheme, token] = (req.headers.authorization || "").split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(403).json({ message: "Invalid or expired token" });
  }
}

// =========================
// HEALTH
// =========================
app.get("/", (req, res) => {
  res.send("SERVER OK");
});

// =========================
// REGISTER
// =========================
app.post("/register", async (req, res) => {
  const name = cleanText(req.body.name, 100);
  const email = cleanText(req.body.email, 255).toLowerCase();
  const password = String(req.body.password ?? "");

  if (!name || !email || !password) {
    return res.status(400).json({ message: "All fields required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters" });
  }

  const [existing] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
  if (existing.length > 0) {
    return res.status(409).json({ message: "Email already registered" });
  }

  const hash = await bcrypt.hash(password, 10);
  await pool.query("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", [name, email, hash]);

  res.status(201).json({ message: "User registered successfully" });
});

// =========================
// LOGIN (JWT)
// =========================
app.post("/login", async (req, res) => {
  const email = cleanText(req.body.email, 255).toLowerCase();
  const password = String(req.body.password ?? "");

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password required" });
  }

  const [rows] = await pool.query("SELECT id, email, password FROM users WHERE email = ?", [email]);
  const user = rows[0];
  const isMatch = user ? await bcrypt.compare(password, user.password) : false;

  if (!isMatch) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: "1d",
  });

  res.json({ message: "Login successful", token });
});

// =========================
// CURRENT USER + ONBOARDING STATUS
// =========================
app.get("/me", verifyToken, async (req, res) => {
  const [users] = await pool.query("SELECT id, name, email FROM users WHERE id = ?", [req.userId]);
  if (users.length === 0) {
    return res.status(404).json({ message: "User not found" });
  }

  const [settings] = await pool.query(
    "SELECT monthly_budget, currency, onboarded_at FROM user_settings WHERE user_id = ?",
    [req.userId]
  );
  const [counts] = await pool.query("SELECT COUNT(*) AS total FROM expenses WHERE user_id = ?", [req.userId]);

  const s = settings[0];
  res.json({
    id: users[0].id,
    name: users[0].name,
    email: users[0].email,
    onboarded: Boolean(s && s.onboarded_at),
    monthlyBudget: s ? Number(s.monthly_budget) : null,
    currency: s ? s.currency : "INR",
    expenseCount: Number(counts[0].total),
  });
});

// =========================
// SETUP WIZARD (runs once)
// =========================
app.post("/setup", verifyToken, async (req, res) => {
  const budget = toAmount(req.body.budget);
  if (!budget) {
    return res.status(400).json({ message: "Enter a monthly budget above zero" });
  }

  const rawCategories = Array.isArray(req.body.categories) ? req.body.categories : [];
  const categories = [...new Set(rawCategories.map((c) => cleanText(c, 40)).filter(Boolean))];
  if (categories.length === 0) {
    return res.status(400).json({ message: "Pick at least one category" });
  }

  const rawSubs = Array.isArray(req.body.subscriptions) ? req.body.subscriptions : [];
  if (rawSubs.length > 50) {
    return res.status(400).json({ message: "Too many subscriptions" });
  }

  const subscriptions = [];
  for (const s of rawSubs) {
    const name = cleanText(s.name, 100);
    const amount = toAmount(s.amount);
    const cycle = s.billingCycle;
    const hasCustomEnd = s.validity === "CUSTOM DATE";

    if (!name || !amount || !["WEEKLY", "MONTHLY", "YEARLY"].includes(cycle)) {
      return res.status(400).json({ message: `Check the details for "${name || "a subscription"}"` });
    }
    if (!isDate(s.startDate) || !isDate(s.nextPayment) || (hasCustomEnd && !isDate(s.validUntil))) {
      return res.status(400).json({ message: `Check the dates for "${name}"` });
    }

    subscriptions.push({
      name,
      amount,
      cycle,
      category: cleanText(s.category, 40) || "Other",
      startDate: s.startDate,
      nextDue: s.nextPayment,
      validUntil: hasCustomEnd ? s.validUntil : null,
      status: s.status === "PAUSED" ? "PAUSED" : "ACTIVE",
      notes: cleanText(s.notes, 500) || null,
    });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [existing] = await conn.query(
      "SELECT onboarded_at FROM user_settings WHERE user_id = ? FOR UPDATE",
      [req.userId]
    );
    if (existing.length > 0 && existing[0].onboarded_at) {
      await conn.rollback();
      return res.status(409).json({ message: "Setup is already complete" });
    }

    await conn.query(
      `INSERT INTO user_settings (user_id, monthly_budget, currency, onboarded_at)
       VALUES (?, ?, 'INR', NOW())
       ON DUPLICATE KEY UPDATE monthly_budget = VALUES(monthly_budget), onboarded_at = NOW()`,
      [req.userId, budget]
    );

    for (const name of categories) {
      await conn.query("INSERT IGNORE INTO categories (user_id, name) VALUES (?, ?)", [req.userId, name]);
    }

    for (const s of subscriptions) {
      await conn.query(
        `INSERT INTO subscriptions
           (user_id, name, amount, billing_cycle, category, start_date, next_due_date, valid_until, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.userId, s.name, s.amount, s.cycle, s.category, s.startDate, s.nextDue, s.validUntil, s.status, s.notes]
      );
    }

    await conn.commit();
    res.status(201).json({ message: "Setup complete" });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

//
//

app.post("/expenses/parse", verifyToken, async (req, res) => {
  try {
    const text = req.body.text;

    if (typeof text !== "string" || !text.trim() || text.length > 500) {
      return res.status(400).json({
        message: "Enter an expense description under 500 characters.",
      });
    }

    const parsed = await parseExpense(text);

    res.json({
      message: "Expense parsed successfully",
      expense: parsed,
    });
  } catch (err) {
    console.error("Gemini parsing error:", err);

    if (err.message.startsWith("Enter ") ||
        err.message.startsWith("Could not ") ||
        err.message.startsWith("Please check ")) {
      return res.status(400).json({ message: err.message });
    }

    res.status(502).json({
      message: "Penny couldn't process that expense right now. Please try again.",
    });
  }
});

// =========================
// ADD EXPENSE
// =========================
app.post("/expenses", verifyToken, async (req, res) => {
  const title = cleanText(req.body.title, 100);
  const amount = toAmount(req.body.amount);
  const category = cleanText(req.body.category, 40);
  const expenseDate = req.body.expense_date;

  if (!title || !amount || !category || !isDate(expenseDate)) {
    return res.status(400).json({ message: "Title, amount, category and a valid date are required" });
  }

  await pool.query(
    "INSERT INTO expenses (user_id, title, amount, category, expense_date) VALUES (?, ?, ?, ?, ?)",
    [req.userId, title, amount, category, expenseDate]
  );

  res.status(201).json({ message: "Expense added successfully" });
});

// =========================
// LIST EXPENSES (latest 100 for now; pagination comes with the dashboard step)
// =========================
app.get("/expenses", verifyToken, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, user_id, title, amount, category,
            DATE_FORMAT(expense_date, '%Y-%m-%d') AS expense_date
       FROM expenses
      WHERE user_id = ?
      ORDER BY expense_date DESC, id DESC
      LIMIT 100`,
    [req.userId]
  );

  res.json(rows);
});

// =========================
// CATEGORY TOTALS
// =========================
app.get("/expenses/category-summary", verifyToken, async (req, res) => {
  const [rows] = await pool.query(
    "SELECT category, SUM(amount) AS total FROM expenses WHERE user_id = ? GROUP BY category",
    [req.userId]
  );

  res.json(rows);
});

// =========================
// MONTHLY TOTALS (grouped by year and month)
// =========================
app.get("/expenses/monthly-summary", verifyToken, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(expense_date, '%Y-%m') AS month, SUM(amount) AS total
       FROM expenses
      WHERE user_id = ?
      GROUP BY DATE_FORMAT(expense_date, '%Y-%m')
      ORDER BY month`,
    [req.userId]
  );

  res.json(rows);
});

// =========================
// UPDATE EXPENSE
// =========================
app.put("/expenses/:id", verifyToken, async (req, res) => {
  const title = cleanText(req.body.title, 100);
  const amount = toAmount(req.body.amount);
  const category = cleanText(req.body.category, 40);
  const expenseDate = req.body.expense_date;

  if (!title || !amount || !category || !isDate(expenseDate)) {
    return res.status(400).json({ message: "Title, amount, category and a valid date are required" });
  }

  const [result] = await pool.query(
    `UPDATE expenses
        SET title = ?, amount = ?, category = ?, expense_date = ?
      WHERE id = ? AND user_id = ?`,
    [title, amount, category, expenseDate, req.params.id, req.userId]
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({ message: "Expense not found or not authorized" });
  }

  res.json({ message: "Expense updated successfully" });
});

// =========================
// DELETE EXPENSE
// =========================
app.delete("/expenses/:id", verifyToken, async (req, res) => {
  const [result] = await pool.query("DELETE FROM expenses WHERE id = ? AND user_id = ?", [
    req.params.id,
    req.userId,
  ]);

  if (result.affectedRows === 0) {
    return res.status(404).json({ message: "Not found" });
  }

  res.json({ message: "Expense deleted successfully" });
});




//
//
//
app.put("/me/profile", verifyToken, async (req, res) => {
  const name = cleanText(req.body.name, 100);
  if (!name) {
    return res.status(400).json({ message: "Enter your name" });
  }
  await pool.query("UPDATE users SET name = ? WHERE id = ?", [name, req.userId]);
  res.json({ message: "Profile updated", name });
});

app.put("/me/password", verifyToken, async (req, res) => {
  const currentPassword = String(req.body.currentPassword ?? "");
  const newPassword = String(req.body.newPassword ?? "");
  if (newPassword.length < 8) {
    return res.status(400).json({ message: "New password must be at least 8 characters" });
  }
  const [rows] = await pool.query("SELECT password FROM users WHERE id = ?", [req.userId]);
  if (rows.length === 0) {
    return res.status(404).json({ message: "User not found" });
  }
  const isMatch = await bcrypt.compare(currentPassword, rows[0].password);
  if (!isMatch) {
    return res.status(401).json({ message: "Your current password is wrong" });
  }
  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query("UPDATE users SET password = ? WHERE id = ?", [hash, req.userId]);
  res.json({ message: "Password updated" });
});

app.get("/settings", verifyToken, async (req, res) => {
  const [settings] = await pool.query(
    "SELECT monthly_budget, currency FROM user_settings WHERE user_id = ?",
    [req.userId]
  );
  const [cats] = await pool.query(
    "SELECT name FROM categories WHERE user_id = ? ORDER BY name",
    [req.userId]
  );
  res.json({
    monthlyBudget: settings[0] ? Number(settings[0].monthly_budget) : 25000,
    currency: settings[0] ? settings[0].currency : "INR",
    categories: cats.map((c) => c.name),
  });
});

app.put("/settings", verifyToken, async (req, res) => {
  const budget = toAmount(req.body.monthlyBudget);
  if (!budget) {
    return res.status(400).json({ message: "Enter a monthly budget above zero" });
  }
  const rawCategories = Array.isArray(req.body.categories) ? req.body.categories : [];
  const categories = [...new Set(rawCategories.map((c) => cleanText(c, 40)).filter(Boolean))];
  if (categories.length === 0) {
    return res.status(400).json({ message: "Keep at least one category" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO user_settings (user_id, monthly_budget, currency)
       VALUES (?, ?, 'INR')
       ON DUPLICATE KEY UPDATE monthly_budget = VALUES(monthly_budget)`,
      [req.userId, budget]
    );
    await conn.query("DELETE FROM categories WHERE user_id = ? AND name NOT IN (?)", [req.userId, categories]);
    for (const name of categories) {
      await conn.query("INSERT IGNORE INTO categories (user_id, name) VALUES (?, ?)", [req.userId, name]);
    }
    await conn.commit();
    res.json({ message: "Preferences saved" });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

async function loadSubscriptions(userId) {
  const [rows] = await pool.query(
    `SELECT id, name, amount, billing_cycle AS billingCycle, category,
            DATE_FORMAT(start_date, '%Y-%m-%d') AS startDate,
            DATE_FORMAT(next_due_date, '%Y-%m-%d') AS nextDue,
            DATE_FORMAT(valid_until, '%Y-%m-%d') AS validUntil,
            status, notes
       FROM subscriptions
      WHERE user_id = ?
      ORDER BY next_due_date`,
    [userId]
  );
  return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
}

function readSubscription(body) {
  const name = cleanText(body.name, 100);
  const amount = toAmount(body.amount);
  if (!name || !amount || !["WEEKLY", "MONTHLY", "YEARLY"].includes(body.billingCycle)) {
    return { error: "Check the name, amount and billing cycle" };
  }
  if (!isDate(body.startDate) || !isDate(body.nextDue)) {
    return { error: `Check the dates for "${name}"` };
  }
  const validUntil = body.validUntil ? body.validUntil : null;
  if (validUntil && !isDate(validUntil)) {
    return { error: `Check the end date for "${name}"` };
  }
  return {
    value: {
      name,
      amount,
      cycle: body.billingCycle,
      category: cleanText(body.category, 40) || "Other",
      startDate: body.startDate,
      nextDue: body.nextDue,
      validUntil,
      status: body.status === "PAUSED" ? "PAUSED" : "ACTIVE",
      notes: cleanText(body.notes, 500) || null,
    },
  };
}

app.get("/subscriptions", verifyToken, async (req, res) => {
  res.json(await loadSubscriptions(req.userId));
});

app.post("/subscriptions", verifyToken, async (req, res) => {
  const parsed = readSubscription(req.body);
  if (parsed.error) {
    return res.status(400).json({ message: parsed.error });
  }
  const s = parsed.value;
  await pool.query(
    `INSERT INTO subscriptions
       (user_id, name, amount, billing_cycle, category, start_date, next_due_date, valid_until, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.userId, s.name, s.amount, s.cycle, s.category, s.startDate, s.nextDue, s.validUntil, s.status, s.notes]
  );
  res.status(201).json({ message: "Subscription added" });
});

app.put("/subscriptions/:id", verifyToken, async (req, res) => {
  const parsed = readSubscription(req.body);
  if (parsed.error) {
    return res.status(400).json({ message: parsed.error });
  }
  const s = parsed.value;
  const [result] = await pool.query(
    `UPDATE subscriptions
        SET name = ?, amount = ?, billing_cycle = ?, category = ?, start_date = ?,
            next_due_date = ?, valid_until = ?, status = ?, notes = ?
      WHERE id = ? AND user_id = ?`,
    [s.name, s.amount, s.cycle, s.category, s.startDate, s.nextDue, s.validUntil, s.status, s.notes, req.params.id, req.userId]
  );
  if (result.affectedRows === 0) {
    return res.status(404).json({ message: "Subscription not found" });
  }
  res.json({ message: "Subscription updated" });
});

app.delete("/subscriptions/:id", verifyToken, async (req, res) => {
  const [result] = await pool.query(
    "DELETE FROM subscriptions WHERE id = ? AND user_id = ?",
    [req.params.id, req.userId]
  );
  if (result.affectedRows === 0) {
    return res.status(404).json({ message: "Subscription not found" });
  }
  res.json({ message: "Subscription removed" });
});


// =========================
// ERROR HANDLER
// =========================
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON" });
  }
  console.error(err);
  res.status(500).json({ message: "Something went wrong" });
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});