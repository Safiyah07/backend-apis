const express = require("express");
const router = express.Router();
const asyncHandler = require("express-async-handler");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const sendEmail = require("../service/sendEmail");
const prisma = require("../config/db");

// get all users with pagination
router.get(
  "/all",
  asyncHandler(async (req, res) => {
    console.log(123);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    try {
      const users = await prisma.users.findMany({
        skip: offset,
        take: limit,
      });

      const totalUsers = await prisma.users.count();
      const totalPages = Math.ceil(totalUsers / limit);

      const pagination = {
        totalUsers,
        totalPages,
        currentPage: page,
        pageSize: limit,
      };

      res.status(200).json({
        success: true,
        message: "Users fetched successfully",
        data: { pagination, users },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Server Error while fetching users",
        error: error.message,
      });
    }
  })
);

// create new user
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { first_name, last_name, email, password } = req.body;

    try {
      const hashedPassword = await bcrypt.hash(password, 10);

      const newUser = await prisma.users.create({
        data: {
          first_name,
          last_name,
          email,
          password: hashedPassword,
        },
      });

      res.status(201).json({
        success: true,
        message: "User created successfully",
        data: newUser,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Server Error while creating user",
        error: error.message,
      });
    }
  })
);

// get user by id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = parseInt(req.params.id);

    try {
      const user = await prisma.users.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      res.status(200).json({
        success: true,
        message: "User fetched successfully",
        data: user,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Server Error while fetching user",
        error: error.message,
      });
    }
  })
);

// update user by id
router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = parseInt(req.params.id);
    const { fields } = req.body;

    try {
      const updatedUser = await prisma.users.update({
        where: { id: userId },
        data: fields,
      });

      res.status(200).json({
        success: true,
        message: "User updated successfully",
        data: updatedUser,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Server Error while updating user",
        error: error.message,
      });
    }
  })
);

// delete user by id
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = parseInt(req.params.id);

    try {
      await prisma.users.delete({
        where: { id: userId },
      });

      res.status(200).json({
        success: true,
        message: "User deleted successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Server Error while deleting user",
        error: error.message,
      });
    }
  })
);

module.exports = router;
