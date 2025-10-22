// require("dotenv").config();
// const { Pool, types } = require("pg");

// types.setTypeParser(1082, (val) => val);

// const pool = new Pool({
//   user: process.env.DB_USER || "postgres",
//   host: process.env.DB_HOST || "localhost",
//   database: process.env.DB_NAME || "portfolio",
//   password: process.env.DB_PASSWORD || "database2970",
//   port: process.env.DB_PORT || 5432,
//   max: 20,
//   idleTimeoutMillis: 30000,
//   connectionTimeoutMillis: 2000,
// });

// // const pool = new Pool({
// //   connectionString: process.env.PROD_DB_URL,
// // });

// pool
//   .connect()
//   .then(async () => {
//     console.log("Connected to PostgreSQL ✅");
//     // await pool.query("SET search_path TO public2");
//   })
//   .catch((err) => console.error("Connection error ❌", err));

// module.exports = pool;

// db.js
const { PrismaClient } = require("@prisma/client");

// Create a single PrismaClient instance
const prisma = new PrismaClient();

// Graceful shutdown (optional but good practice)
process.on("beforeExit", async () => {
  await prisma.$disconnect();
});

// Export the client
module.exports = prisma;
