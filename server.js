const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const morgan = require("morgan");
require("events").EventEmitter.defaultMaxListeners = 20;
const cookieParser = require("cookie-parser");
const swaggerUi = require("swagger-ui-express");
const fs = require("fs");
const path = require("path");
const { swaggerDocs } = require("./swagger");

require("./src/config/db");

const PORT = process.env.PORT || 3000;

dotenv.config();

const app = express();

// load the spec (JSON or YAML parsed to a JS object)
const openapiSpec = JSON.parse(
  fs.readFileSync(path.join(__dirname, "openapi.json"))
);

// Serve Swagger UI at /docs
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));

swaggerDocs(app);

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
app.use("/api/users", require("./src/api/user"));

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
