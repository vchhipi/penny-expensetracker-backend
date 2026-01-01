console.log("🔥 MAIN SERVER RUNNING 🔥");

const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");

const app = express();
app.use(cors());
app.use(express.json());

// routes
app.use("/api", authRoutes);

// test route
app.get("/", (req, res) => {
  res.send("Expense Tracker API Running");
});

app.listen(4000, "127.0.0.1", () => {
  console.log("🚀 Server running on http://127.0.0.1:4000");
});

