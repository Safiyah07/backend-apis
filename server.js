const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const morgan = require("morgan");
require("events").EventEmitter.defaultMaxListeners = 20;
const cookieParser = require("cookie-parser");

require("./src/config/db");

const PORT = process.env.PORT || 3000;

dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(morgan("dev"));
app.use(express.json());
app.use(
  cors({
    // origin: "http://localhost:4200",
    origin: "*",
    credentials: true,
  })
);
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Routes
app.get("/", (req, res) => {
  res.status(200).send("🚀 Server is running...");
});

app.use("/api/auth", require("./src/api/auth"));

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
