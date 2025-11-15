const express = require("express");
const router = express.Router();
const asyncHandler = require("express-async-handler");
const { paystackService } = require("../service/paymentProvider");
const prisma = require("../config/db");

router.post(
  "/pay",
  asyncHandler(async (req, res) => {
    try {
      const { user_type, user_id, email, amount } = req.body;

      // Generate a unique reference
      const reference = `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // Initialize payment with provider
      const response = await paystackService.initializePayment(email, amount);

      // save to db with prisma
      await prisma.payments.create({
        data: {
          user_type,
          user_id,
          amount,
          reference,
          payment_provider: "paystack",
          status: "pending",
          provider_response: response.data,
        },
      });

      // Save to database
      // await db.query(
      //   `INSERT INTO payments (user_id, amount, reference, payment_provider, status, provider_response)
      //  VALUES ($1, $2, $3, $4, $5, $6)`,
      //   [user_id, amount, reference, "paystack", "pending", response.data]
      // );

      return res.status(200).json({
        success: true,
        message: "Payment initialized",
        data: response.data,
      });
    } catch (error) {
      console.error("Payment error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Payment initialization failed",
        error: error.message,
      });
    }
  })
);

module.exports = router;
