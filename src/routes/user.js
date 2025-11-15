const express = require("express");
const router = express.Router();
const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");
const prisma = require("../config/db");

// get all users with pagination
/**
 * @swagger
 * /api/users/all:
 *   get:
 *     summary: Get all users with pagination and optional name filter
 *     description: Fetch a paginated list of users. You can optionally filter results by name (first, middle, or last).
 *     tags:
 *       - Users
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of users per page
 *       - in: query
 *         name: name
 *         schema:
 *           type: string
 *         description: Filter users by first, middle, or last name (case-insensitive)
 *     responses:
 *       200:
 *         description: Users fetched successfully
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
 *                   example: Users fetched successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         totalUsers:
 *                           type: integer
 *                           example: 45
 *                         totalPages:
 *                           type: integer
 *                           example: 5
 *                         currentPage:
 *                           type: integer
 *                           example: 1
 *                         pageSize:
 *                           type: integer
 *                           example: 10
 *                     users:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                             example: 1
 *                           avatar_url:
 *                             type: string
 *                             example: https://example.com/avatar.jpg
 *                           first_name:
 *                             type: string
 *                             example: John
 *                           middle_name:
 *                             type: string
 *                             example: A.
 *                           last_name:
 *                             type: string
 *                             example: Doe
 *                           email:
 *                             type: string
 *                             example: john.doe@example.com
 *                           phone_number:
 *                             type: string
 *                             example: "+2348012345678"
 *                           user_code:
 *                             type: string
 *                             example: USR12345
 *                           terms:
 *                             type: boolean
 *                             example: true
 *                           created_at:
 *                             type: string
 *                             format: date-time
 *                             example: 2025-01-15T10:23:45.000Z
 *                           updated_at:
 *                             type: string
 *                             format: date-time
 *                             example: 2025-02-20T08:12:30.000Z
 *       500:
 *         description: Server Error while fetching users
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
 *                   example: Server Error while fetching users
 *                 error:
 *                   type: string
 *                   example: Detailed error message
 */

router.get(
  "/all",
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const name = req.query.name || ""; // ← get the name filter if provided

    try {
      const whereClause = name
        ? {
            OR: [
              { first_name: { contains: name, mode: "insensitive" } },
              { middle_name: { contains: name, mode: "insensitive" } },
              { last_name: { contains: name, mode: "insensitive" } },
            ],
          }
        : {};

      const users = await prisma.users.findMany({
        skip: offset,
        take: limit,
        where: whereClause,
        select: {
          id: true,
          avatar_url: true,
          first_name: true,
          middle_name: true,
          last_name: true,
          email: true,
          phone_number: true,
          user_code: true,
          terms: true,
          created_at: true,
          updated_at: true,
        },
      });

      const totalUsers = await prisma.users.count({ where: whereClause });
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
/**
 * @swagger
 * /api/users/user:
 *   post:
 *     summary: Create a user
 *     tags:
 *       - Users
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of users per page
 *     description: Get all users and their details.
 *     responses:
 *       200:
 *         description: All users fetched successfully
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
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         totalUsers:
 *                           type: integer
 *                         totalPages:
 *                           type: integer
 *                         currentPage:
 *                           type: integer
 *                         pageSize:
 *                           type: integer
 *                     users:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                           avatar_url:
 *                             type: string
 *                           first_name:
 *                             type: string
 *                           middle_name:
 *                             type: string
 *                           last_name:
 *                             type: string
 *                           email:
 *                             type: string
 *                           phone_number:
 *                             type: string
 *                           user_code:
 *                             type: string
 *                           terms:
 *                             type: boolean
 *                           created_at:
 *                             type: string
 *                             format: date-time
 *                           updated_at:
 *                             type: string
 *                             format: date-time
 *       500:
 *         description: Server error while fetching users
 */

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const {
      first_name,
      middle_name,
      last_name,
      email,
      phone_number,
      password,
    } = req.body;

    try {
      // validation
      if (!first_name || !last_name || !email || !phone_number) {
        return res.status(400).json({
          success: false,
          message: "Please provide all required fields",
        });
      }

      // check if user already exists
      const existingUser = await prisma.users.findUnique({
        where: { email },
      });

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "User with this email already exists",
        });
      }

      // hash password
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
/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Get user by ID
 *     tags:
 *       - Users
 *     description: Retrieve details of a specific user using their unique ID.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The ID of the user to fetch
 *     responses:
 *       200:
 *         description: User fetched successfully
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
 *                   example: User fetched successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     avatar_url:
 *                       type: string
 *                     first_name:
 *                       type: string
 *                     middle_name:
 *                       type: string
 *                     last_name:
 *                       type: string
 *                     email:
 *                       type: string
 *                     phone_number:
 *                       type: string
 *                     user_code:
 *                       type: string
 *                     terms:
 *                       type: boolean
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *                     updated_at:
 *                       type: string
 *                       format: date-time
 *       404:
 *         description: User not found
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
 *                   example: User not found
 *       500:
 *         description: Server Error while getting user
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
 *                   example: Server Error while fetching user
 *                 error:
 *                   type: string
 *                   example: Detailed error message
 */

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = parseInt(req.params.id);

    try {
      const user = await prisma.users.findUnique({
        where: { id: userId },
        select: {
          id: true,
          avatar_url: true,
          first_name: true,
          middle_name: true,
          last_name: true,
          email: true,
          phone_number: true,
          user_code: true,
          terms: true,
          created_at: true,
          updated_at: true,
        },
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
/**
 * @swagger
 * /api/users/{id}:
 *   put:
 *     summary: Update a user by ID
 *     description: Update one or more fields of a specific user using their unique ID.
 *     tags:
 *       - Users
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID of the user to update
 *         schema:
 *           type: integer
 *         example: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fields:
 *                 type: object
 *                 description: Fields to update (partial or full)
 *                 properties:
 *                   first_name:
 *                     type: string
 *                     example: Jane
 *                   middle_name:
 *                     type: string
 *                     example: A.
 *                   last_name:
 *                     type: string
 *                     example: Doe
 *                   email:
 *                     type: string
 *                     example: jane.doe@example.com
 *                   phone_number:
 *                     type: string
 *                     example: 08012345678
 *                   avatar_url:
 *                     type: string
 *                     example: https://example.com/avatar.jpg
 *                   terms:
 *                     type: boolean
 *                     example: true
 *     responses:
 *       200:
 *         description: User updated successfully
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
 *                     id:
 *                       type: integer
 *                     avatar_url:
 *                       type: string
 *                     first_name:
 *                       type: string
 *                     middle_name:
 *                       type: string
 *                     last_name:
 *                       type: string
 *                     email:
 *                       type: string
 *                     phone_number:
 *                       type: string
 *                     user_code:
 *                       type: string
 *                     terms:
 *                       type: boolean
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *                     updated_at:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Invalid request or missing parameters
 *       404:
 *         description: User not found
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
 *                   example: User not found
 *       500:
 *         description: Server Error while updating user
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
 *                   example: Server Error while updating user
 *                 error:
 *                   type: string
 *                   example: Detailed error message
 */

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = parseInt(req.params.id);
    const { fields } = req.body;

    try {
      // check if user exists
      const user = await prisma.users.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }
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
/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     summary: Delete a user by ID
 *     description: Permanently remove a user from the database using their unique ID.
 *     tags:
 *       - Users
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID of the user to delete
 *         schema:
 *           type: integer
 *         example: 1
 *     responses:
 *       200:
 *         description: User deleted successfully
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
 *                   example: User deleted successfully
 *       404:
 *         description: User not found
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
 *                   example: User not found
 *       500:
 *         description: Server Error while deleting user
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
 *                   example: Server Error while deleting user
 *                 error:
 *                   type: string
 *                   example: Detailed error message
 */

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = parseInt(req.params.id);

    try {
      // check if user exists
      const user = await prisma.users.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // delete user
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
