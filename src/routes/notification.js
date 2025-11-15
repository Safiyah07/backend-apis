const express = require("express");
const router = express.Router();
const asyncHandler = require("express-async-handler");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const sendEmail = require("../service/sendEmail");
const prisma = require("../config/db");

// message notification between users
// create notification
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { senderId, receiverId, message } = req.body;

    // use websockets in real implementation and store in db
    // use try catch for error handling in real implementation
    const notification = await prisma.notification.create({
      data: {
        senderId,
        receiverId,
        message,
      },
    });

    res.status(201).json(notification);
  })
);

// get notifications for a user
