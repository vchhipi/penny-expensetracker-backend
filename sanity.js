const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("SANITY OK");
});

app.post("/test", (req, res) => {
  res.json({ message: "POST OK" });
});

app.listen(5001, () => {
  console.log("🔥 SANITY SERVER on http://localhost:5001");
});
