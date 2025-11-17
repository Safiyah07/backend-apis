const express = require("express");
const router = express.Router();
const asyncHandler = require("express-async-handler");
const { paystackService } = require("../service/paymentProvider");
const prisma = require("../config/db");
const { mapPaystackToInternal } = require("../utils/paystackStatus");

// accept payments
// router.post(
//   "/pay",
//   asyncHandler(async (req, res) => {
//     try {
//       const { user_type, user_id, email, amount } = req.body;

//       // check if user exists
//       const userExists = await prisma.users.findUnique({
//         where: { email },
//       });

//       // Initialize payment with provider
//       const response = await paystackService.initializePayment(email, amount);
//       console.log(response.data);

//       // save to db with prisma
//       await prisma.payment.create({
//         data: {
//           user_type,
//           user_id,
//           amount,
//           reference: response.data.reference,
//           payment_provider: "paystack",
//           status: "pending",
//           provider_response: response.data,
//         },
//       });

//       return res.status(200).json({
//         success: true,
//         message: "Payment initialized",
//         data: response.data,
//       });
//     } catch (error) {
//       console.error("Payment error:", error.message);
//       return res.status(500).json({
//         success: false,
//         message: "Payment initialization failed",
//         error: error.message,
//       });
//     }
//   })
// );

const PAYMENT_EXPIRY_MINUTES = 15;

// accept payments
/**
 * @swagger
 * /api/payments/pay:
 *   post:
 *     summary: Initialize a payment or return existing pending transaction
 *     description: |
 *       Creates a new payment session using Paystack if no active pending payment exists for the same user and amount.
 *       If a valid pending payment exists, the existing authorization URL is returned instead of creating a new one.
 *     tags:
 *       - Payments
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - amount
 *             properties:
 *               user_type:
 *                 type: string
 *                 example: "student"
 *                 description: The type/category of the user initiating payment
 *               user_id:
 *                 type: integer
 *                 example: 5
 *                 description: The user ID associated with the payment (optional if user type does not require ID)
 *               email:
 *                 type: string
 *                 example: "test@example.com"
 *                 description: Email address used to initialize Paystack payment
 *               amount:
 *                 type: number
 *                 example: 5000
 *                 description: Payment amount in the lowest currency unit (e.g., kobo)
 *     responses:
 *       200:
 *         description: Payment initialized or existing pending payment returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     reference:
 *                       type: string
 *                       example: "6fjs83kfnv73"
 *                     authorization_url:
 *                       type: string
 *                       example: "https://checkout.paystack.com/xyz123"
 *       400:
 *         description: Required fields missing (email or amount)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                   example: "email and amount required"
 *       500:
 *         description: Server or provider initialization failure
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                   example: "Server Error: Payment initialization failed"
 */

router.post(
  "/pay",
  asyncHandler(async (req, res) => {
    const { user_type, user_id, email, amount } = req.body;
    try {
      if (!email || !amount) {
        return res
          .status(400)
          .json({ success: false, message: "email and amount required" });
      }

      // 1) check for existing non-expired pending payment for same user/email/amount
      const now = new Date();
      const existing = await prisma.payment.findFirst({
        where: {
          user_type,
          user_id,
          amount,
          status: "pending",
          expires_at: { gt: now }, // not expired
        },
        orderBy: { created_at: "desc" },
      });

      if (existing) {
        // return existing authorization url (from provider_response) to avoid new initializations
        const authUrl = existing.provider_response?.authorization_url;
        return res.status(200).json({
          success: true,
          message: "Existing pending payment found",
          data: {
            reference: existing.reference,
            authorization_url: authUrl,
          },
        });
      }

      // 2) initialize with paystack
      const response = await paystackService.initializePayment(email, amount);
      const psData = response.data;

      // compute expiry
      const expiresAt = new Date(
        Date.now() + PAYMENT_EXPIRY_MINUTES * 60 * 1000
      );

      // 3) save paystack-provided reference and response
      const payment = await prisma.payment.create({
        data: {
          user_type,
          user_id,
          amount,
          reference: psData.reference,
          payment_provider: "paystack",
          status: "pending",
          provider_response: psData,
          expires_at: expiresAt,
        },
      });

      return res.status(200).json({
        success: true,
        message: "Payment initialized",
        data: psData, // includes authorization_url & reference
      });
    } catch (error) {
      console.error("Payment error:", error);
      return res.status(500).json({
        success: false,
        message: "Server Error: Payment initialization failed",
      });
    }
  })
);

// verify payments
// router.get(
//   "/verify",
//   asyncHandler(async (req, res) => {
//     try {
//       const { reference } = req.query;

//       if (!reference) {
//         return res.status(400).json({
//           success: false,
//           message: "Reference is required",
//         });
//       }

//       // Verify from Paystack
//       const response = await paystackService.verifyPayment(reference);
//       const data = response.data;

//       if (data.status === "success") {
//         await prisma.payment.update({
//           where: { reference },
//           data: {
//             status: "paid",
//             paid_at: new Date(),
//             provider_response: data,
//           },
//         });

//         return res.status(200).json({
//           success: true,
//           message: "Payment verified and marked as paid",
//           data,
//         });
//       }

//       // For any other status
//       await prisma.payment.update({
//         where: { reference },
//         data: {
//           status: data.status, // abandoned / failed / pending / reversed
//           provider_response: data,
//         },
//       });

//       return res.json({
//         success: true,
//         message: "Payment verified successfully",
//         data,
//       });
//     } catch (error) {
//       console.log(error.response?.data || error);

//       return res.status(500).json({
//         success: false,
//         message: "Payment verification failed",
//       });
//     }
//   })
// );

// verify payments
/**
 * @swagger
 * /api/payments/verify:
 *   get:
 *     summary: Verify a payment status using Paystack reference
 *     description: |
 *       Verifies a payment using the Paystack transaction reference.
 *       The transaction status is mapped to internal status and stored in the database.
 *       If the payment is confirmed as successful, it is marked as **paid**.
 *     tags:
 *       - Payments
 *     parameters:
 *       - in: query
 *         name: reference
 *         schema:
 *           type: string
 *         required: true
 *         description: Paystack transaction reference to verify
 *         example: "7xgk29mfld3"
 *     responses:
 *       200:
 *         description: Payment verified successfully and marked as paid
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Payment verified and marked paid"
 *                 data:
 *                   type: object
 *                   description: Full Paystack verification response data
 *       400:
 *         description: Missing reference or payment not successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Payment not successful: failed"
 *                 data:
 *                   type: object
 *                   description: Paystack response data
 *       500:
 *         description: Server or provider verification failure
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                   example: "Server Error: Payment verification failed"
 */

router.get(
  "/verify",
  asyncHandler(async (req, res) => {
    const { reference } = req.query;

    try {
      if (!reference)
        return res
          .status(400)
          .json({ success: false, message: "Reference required" });

      const response = await paystackService.verifyPayment(reference);
      const psData = response.data;
      const internalStatus = mapPaystackToInternal(psData.status);

      // Update DB (idempotent update)
      const updatePayload = {
        status: internalStatus,
        provider_response: psData,
      };
      if (internalStatus === "paid") {
        updatePayload.paid_at = new Date();
      }

      await prisma.payment.updateMany({
        // updateMany to avoid throw if not found (or use try/catch)
        where: { reference },
        data: updatePayload,
      });

      if (internalStatus === "paid") {
        return res.status(200).json({
          success: true,
          message: "Payment verified and marked paid",
          data: psData,
        });
      } else {
        return res.status(400).json({
          success: false,
          message: `Payment not successful: ${psData.status}`,
          data: psData,
        });
      }
    } catch (error) {
      console.error("Verification error:", error);
      return res.status(500).json({
        success: false,
        message: "Server Error: Payment verification failed",
      });
    }
  })
);

const crypto = require("crypto");

router.post(
  "/webhook/paystack",
  express.raw({ type: "application/json" }), // raw body required for signature verification
  asyncHandler(async (req, res) => {
    try {
      const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
      const signature = req.headers["x-paystack-signature"];
      const payload = req.body; // raw buffer because of express.raw

      // compute hmac
      const hash = crypto
        .createHmac("sha512", PAYSTACK_SECRET)
        .update(payload)
        .digest("hex");

      if (signature !== hash) {
        console.warn("Invalid webhook signature");
        return res.status(400).send("Invalid signature");
      }

      const event = JSON.parse(payload.toString()); // now safe to parse
      const eventData = event.data;
      const eventType = event.event; // e.g., "charge.success", "charge.failed", etc.

      // find the payment - Paystack returns reference at event.data.reference
      const psReference = eventData?.reference;
      const paystackStatus =
        eventData?.status ||
        (eventType === "charge.success" ? "success" : undefined);
      const internalStatus = mapPaystackToInternal(paystackStatus);

      // Idempotency: only update if DB status is different
      const current = await prisma.payment.findUnique({
        where: { reference: psReference },
      });
      if (!current) {
        // optional: create record if not exist, or log & return
        console.warn("Webhook for unknown reference:", psReference);
        return res.status(200).send("ok");
      }

      if (current.status === internalStatus) {
        // already processed
        return res.status(200).send("ok");
      }

      const updateData = {
        status: internalStatus,
        provider_response: eventData,
      };
      if (internalStatus === "paid") updateData.paid_at = new Date();

      await prisma.payment.update({
        where: { reference: psReference },
        data: updateData,
      });

      // respond 200 quickly
      res.status(200).send("ok");
    } catch (err) {
      console.error("Webhook error:", err);
      res.status(500).send("error");
    }
  })
);

// List payment history - with pagination and status filter
/**
 * @swagger
 * /api/payments:
 *   get:
 *     summary: Get all payments with pagination and optional filtering
 *     description: Retrieve a paginated list of all payment records. Supports filtering by status.
 *     tags:
 *       - Payments
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         required: false
 *         description: Page number for pagination
 *         example: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 10
 *         required: false
 *         description: Number of records per page
 *         example: 10
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, paid, failed, expired]
 *         required: false
 *         description: Filter payments by status
 *         example: "pending"
 *     responses:
 *       200:
 *         description: Paginated list of payments retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     currentPage:
 *                       type: integer
 *                       example: 1
 *                     totalPages:
 *                       type: integer
 *                       example: 5
 *                     totalCount:
 *                       type: integer
 *                       example: 43
 *                     limit:
 *                       type: integer
 *                       example: 10
 *                 data:
 *                   type: array
 *                   description: List of payment records
 *                   items:
 *                     type: object
 *                     example:
 *                       id: "673b24862f32b0cd80d04d12"
 *                       user_type: "student"
 *                       user_id: "64bc5ae76c9d8c001f43f700"
 *                       amount: 5000
 *                       status: "paid"
 *                       payment_provider: "paystack"
 *                       reference: "sk_test_x85sks27"
 *                       created_at: "2025-01-01T10:15:30Z"
 *                       updated_at: "2025-01-01T10:20:00Z"
 *       500:
 *         description: Server error encountered while fetching payments
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Internal server error"
 */

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, status } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    try {
      const where = {};
      if (status) where.status = status;

      const [payments, totalCount] = await Promise.all([
        prisma.payment.findMany({
          where,
          orderBy: { created_at: "desc" },
          skip,
          take: Number(limit),
        }),
        prisma.payment.count({ where }),
      ]);

      res.json({
        success: true,
        pagination: {
          currentPage: Number(page),
          totalPages: Math.ceil(totalCount / Number(limit)),
          totalCount,
          limit: Number(limit),
        },
        data: payments,
      });
    } catch (error) {
      console.log(error);
      return res.status(500).json({ success: false, message: error.message });
    }
  })
);

// Get payment history by payment id
/**
 * @swagger
 * /api/payments/{id}:
 *   get:
 *     summary: Get a single payment by ID
 *     description: Retrieve detailed information for a specific payment using its numeric ID.
 *     tags:
 *       - Payments
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Numeric ID of the payment
 *         example: 2
 *     responses:
 *       200:
 *         description: Payment record retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   description: Payment details object
 *                   example:
 *                     id: 2
 *                     user_type: "student"
 *                     user_id: "64bc5ae76c9d8c001f43f700"
 *                     amount: 5000
 *                     status: "pending"
 *                     payment_provider: "paystack"
 *                     reference: "sk_test_x85sks27"
 *                     created_at: "2025-01-01T10:15:30Z"
 *                     updated_at: "2025-01-01T10:16:30Z"
 *       404:
 *         description: Payment record not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               example:
 *                 success: false
 *                 message: "Payment with id not found"
 *       500:
 *         description: Server or database error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               example:
 *                 success: false
 *                 message: "Server error"
 */

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    try {
      const payment = await prisma.payment.findUnique({
        where: { id },
      });

      if (!payment)
        return res.status(404).json({
          success: false,
          message: "Payment with id not found",
        });

      return res.json({
        success: true,
        data: payment,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  })
);

// Get payment history by reference id
/**
 * @swagger
 * /api/payments/reference/{reference}:
 *   get:
 *     summary: Get a payment by transaction reference
 *     description: Retrieve detailed payment information using the unique payment reference generated by the payment provider.
 *     tags:
 *       - Payments
 *     parameters:
 *       - in: path
 *         name: reference
 *         schema:
 *           type: string
 *         required: true
 *         description: Unique payment reference string issued by Paystack or another payment provider
 *         example: "xgk29mfld3"
 *     responses:
 *       200:
 *         description: Payment record retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   description: Payment details object
 *                   example:
 *                     id: 2
 *                     user_type: "student"
 *                     user_id: "64bc5ae76c9d8c001f43f700"
 *                     amount: 5000
 *                     status: "paid"
 *                     payment_provider: "paystack"
 *                     reference: "xgk29mfld3"
 *                     created_at: "2025-01-01T10:15:30Z"
 *                     updated_at: "2025-01-01T10:16:30Z"
 *       404:
 *         description: Payment record not found using reference
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               example:
 *                 success: false
 *                 message: "Payment with reference id not found"
 *       500:
 *         description: Server or database error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               example:
 *                 success: false
 *                 message: "Server error"
 */

router.get(
  "/reference/:reference",
  asyncHandler(async (req, res) => {
    const { reference } = req.params;
    try {
      const payment = await prisma.payment.findUnique({
        where: { reference },
      });

      if (!payment)
        return res.status(404).json({
          success: false,
          message: "Payment with reference id not found",
        });

      return res.json({ success: true, data: payment });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  })
);

module.exports = router;
