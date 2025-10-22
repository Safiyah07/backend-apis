const express = require("express");
const router = express.Router();
const asyncHandler = require("express-async-handler");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const sendEmail = require("../service/sendEmail");

const prisma = require("../config/db");

const generateSecureCode = (length = 4) => {
  return Math.random()
    .toString()
    .slice(2, 2 + length); // e.g. "4830"
};

const RESEND_COOLDOWN_MINUTES = 2;

// sign up user and send email
/**
 * @swagger
 * /api/auth/sign-up:
 *   post:
 *     summary: Register/Signup a new user
 *     description: Register new user with user details.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - first_name
 *               - last_name
 *               - email
 *               - phone_number
 *               - password
 *               - confirm_password
 *             properties:
 *               avatar_url:
 *                 type: string
 *                 example: https://example.com/avatar.jpg
 *               first_name:
 *                 type: string
 *                 example: John
 *               middle_name:
 *                 type: string
 *                 example: M
 *               last_name:
 *                 type: string
 *                 example: Doe
 *               email:
 *                 type: string
 *                 example: user@example.com
 *               phone_number:
 *                 type: string
 *                 example: 08012345678
 *               password:
 *                 type: string
 *                 example: password123
 *               confirm_password:
 *                 type: string
 *                 example: password123
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Bad request (e.g., missing fields, wrong password)
 *       500:
 *         description: Server error during registration
 */

router.post(
  "/sign-up",
  asyncHandler(async (req, res) => {
    const {
      avatar_url,
      first_name,
      middle_name,
      last_name,
      email,
      phone_number,
      password,
      confirm_password,
    } = req.body;

    // basic validation
    if (
      !first_name ||
      !last_name ||
      !email ||
      !phone_number ||
      !password ||
      !confirm_password
    ) {
      console.log({ message: "Please fill all fields." });
      return res.status(400).json({ message: "Please fill all fields." });
    }

    // check if passwords match
    if (password !== confirm_password) {
      console.log({ message: "Passwords do not match." });
      return res.status(400).json({ message: "Passwords do not match." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    try {
      const userExists = await prisma.users.findUnique({
        where: { email },
        select: { email: true },
      });

      if (userExists) {
        return res
          .status(400)
          .json({ message: "User already registered. Please log in." });
      }

      // generate unique user_code
      let unique = false;
      let user_code;
      while (!unique) {
        user_code = `S${Math.floor(100000 + Math.random() * 900000)}`; // e.g. S123456

        const idCheck = await prisma.users.findUnique({
          where: { user_code },
          select: { id: true },
        });
        if (idCheck === null) {
          unique = true;
        }
      }

      // insert new user into database
      const user = await prisma.users.create({
        data: {
          user_code,
          avatar_url,
          first_name,
          middle_name,
          last_name,
          email,
          phone_number,
          password: hashedPassword,
        },
      });

      const userType = "user";

      // console.log(user.rows[0]);
      const newUser = user;

      // Step 4: Generate refresh/access token
      const { token: refreshToken, expiresAt } = generateRefreshToken(
        newUser.id,
        userType
      );

      const existingToken = await prisma.refresh_tokens.findFirst({
        where: {
          user_type: userType,
          user_id: newUser.id,
          purpose: `${userType} login`,
        },
        orderBy: {
          expires_at: "desc",
        },
        select: { id: true },
      });

      if (existingToken) {
        await prisma.refresh_tokens.update({
          where: { id: existingToken.id },
          data: {
            token: refreshToken,
            expires_at: expiresAt,
            revoked: false,
          },
        });
      } else {
        await prisma.refresh_tokens.create({
          data: {
            user_type: userType,
            user_id: newUser.id,
            token: refreshToken,
            expires_at: expiresAt,
            purpose: `${userType} login`,
          },
        });
      }

      // Cookie options
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "None",
        path: "/",
        // ...(remember_user && { maxAge: 30 * 24 * 60 * 60 * 1000 }),
      };

      const accessToken = generateAccessToken(user.id, userType);

      // Set cookie in response
      res.cookie("refreshToken", refreshToken, cookieOptions);

      // Prepare email content
      // console.log(email);
      let to, subject, message;

      to = email;
      subject = "Welcome to Our Platform 🎉";
      message = `Hi ${first_name},<br><br>
         Your account has been successfully created.<br>
        You can now log in using either your email or phone number and the password you set during registration.<br><br>
        Thank you for joining us!<br><br>
        Best regards,<br>The Admin Team`;

      // Send email
      await sendEmail(to, subject, message)
        .then((res) => res)
        .catch((err) => {
          console.error("Send Email Error:", err);
          return { success: false, error: err.message };
        });

      res.status(201).json({
        message: "User registered successfully!",
        data: {
          userType,
          ...accessToken,
          refreshToken,
        },
      });
    } catch (error) {
      console.error(error);
      res
        .status(500)
        .json({ message: "Server error during registration", data: null });
    }
  })
);

// send verification code for registration
/**
 * @swagger
 * /api/auth/send-ver-code:
 *   post:
 *     summary: Register/Signup a new user and send verification code
 *     description: Register new user with user details and send verification code.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - first_name
 *               - last_name
 *               - email
 *               - phone_number
 *               - password
 *               - confirm_password
 *             properties:
 *               avatar_url:
 *                 type: string
 *                 example: https://example.com/avatar.jpg
 *               first_name:
 *                 type: string
 *                 example: John
 *               middle_name:
 *                 type: string
 *                 example: M
 *               last_name:
 *                 type: string
 *                 example: Doe
 *               email:
 *                 type: string
 *                 example: user@example.com
 *               phone_number:
 *                 type: string
 *                 example: 08012345678
 *               password:
 *                 type: string
 *                 example: password123
 *               confirm_password:
 *                 type: string
 *                 example: password123
 *               terms:
 *                 type: boolean
 *                 example: true/false
 *     responses:
 *       200:
 *         description: Verification code sent successfully to your email or spam. Please verify to complete registration.
 *       400:
 *         description: Bad request (e.g., missing fields, wrong password)
 *       429:
 *         description: Too many requests - please try again later.
 *       500:
 *         description: Server error while sending verification code
 */

router.post(
  "/send-ver-code",
  asyncHandler(async (req, res) => {
    const {
      avatar_url,
      first_name,
      middle_name,
      last_name,
      email,
      phone_number,
      password,
      confirm_password,
      terms,
    } = req.body;

    if (password !== confirm_password) {
      return res.status(400).json({ message: "Passwords do not match." });
    }

    const code = generateSecureCode(4);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const now = new Date();

    const hashedPassword = await bcrypt.hash(password, 10);

    // Prepare email content
    // console.log(email);
    let to, subject, message;

    to = email;
    subject = "Welcome to Our Platform 🎉";
    message = `Hi ${first_name},<br><br>
         Your account is 90% ready!<br>
        Use this code <h2 style="color:rgb(249, 76, 226);">${code}</h2> to verify your email and you'll be good to go.<br><br>
        The code expires in 1 hour.<br>
        Thank you for joining us, almost!<br><br>
        Best regards,<br>The Admin Team`;

    try {
      const userExists = await prisma.users.findUnique({
        where: { email },
        select: { email: true },
      });
      if (userExists) {
        return res.status(400).json({
          message: "User already registered. Please log in.",
        });
      }

      const verificationResult = await prisma.verification_codes.findUnique({
        where: { email },
      });

      if (verificationResult) {
        const existing = verificationResult.rows[0];
        const lastSentAt = new Date(existing.last_sent_at);
        const diffMs = now - lastSentAt;
        const diffMinutes = diffMs / 1000 / 60;

        if (diffMinutes < RESEND_COOLDOWN_MINUTES) {
          return res.status(429).json({
            message: `Please wait ${Math.ceil(
              RESEND_COOLDOWN_MINUTES - diffMinutes
            )} more minute(s) before requesting a new code.`,
          });
        }

        // Update existing record with new code + expires_at + last_sent_at
        await prisma.verification_codes.update({
          where: { email },
          data: {
            code,
            expires_at: expiresAt,
            last_sent_at: now,
          },
        });

        // Send email
        await sendEmail(to, subject, message)
          .then((res) => res)
          .catch((err) => {
            console.error("Send Email Error:", err);
            return { success: false, error: err.message };
          });

        return res.status(200).json({
          message: "A new verification code has been sent to your email.",
        });
      }

      // Insert new pending verification
      await prisma.verification_codes.create({
        data: {
          code_for: "signup with code",
          first_name,
          middle_name: middle_name || "",
          last_name,
          email,
          phone_number,
          password: hashedPassword,
          terms: terms || false,
          code,
          expires_at: expiresAt,
          last_sent_at: now,
        },
      });

      // Send email
      await sendEmail(to, subject, message)
        .then((res) => res)
        .catch((err) => {
          console.error("Send Email Error:", err);
          return { success: false, error: err.message };
        });

      res.status(200).json({
        success: true,
        message: "Verification code sent successfully to your email or spam.",
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: "Server error while sending verification code.",
      });
    }
  })
);

// compare verification code /compare-ver-code
/**
 * @swagger
 * /api/auth/compare-ver-code:
 *   post:
 *     summary: Compare verification code to verify user email and to complete user registration
 *     description: Complete registration of new user and confirm verification code.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - code
 *             properties:
 *               email:
 *                 type: string
 *                 example: user@example.com
 *               code:
 *                 type: string
 *                 example: 9876
 *     responses:
 *       200:
 *         description: Verification successful. User registered and welcome email sent.
 *       500:
 *         description: Server error during email verification
 */

router.post(
  "/compare-ver-code",
  asyncHandler(async (req, res) => {
    const { email, code: userCode } = req.body;

    try {
      // Step 1: Check for a valid, unused, unexpired verification code
      // const result = await pool.query(
      //   `SELECT * FROM verification_codes
      //  WHERE email = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()`,
      //   [email, userCode]
      // );

      const result = await prisma.verification_codes.findFirst({
        where: {
          email,
          code: userCode,
          used: false,
          expires_at: { gt: new Date() },
        },
      });

      if (result === null) {
        return res.status(400).json({ error: "Invalid or expired code" });
      }

      const verifiedUser = result;

      // generate unique user_code
      let unique = false;
      let user_code;
      while (!unique) {
        user_code = `S${Math.floor(100000 + Math.random() * 900000)}`; // e.g. S123456

        const idCheck = await prisma.users.findUnique({
          where: { user_code },
          select: { id: true },
        });

        if (idCheck === null) {
          unique = true;
        }
      }

      // Step 2: Insert user data into `schools` table

      await prisma.users.create({
        data: {
          user_code,
          first_name: verifiedUser.first_name,
          middle_name: verifiedUser.middle_name || "",
          last_name: verifiedUser.last_name,
          email: verifiedUser.email,
          phone_number: verifiedUser.phone_number,
          password: verifiedUser.password,
          terms: verifiedUser.terms || false,
        },
      });

      // Step 3: Delete the used verification code
      await prisma.verification_codes.delete({
        where: { id: verifiedUser.id },
      });

      // Prepare welcome email content
      let to, subject, message;

      to = email;
      subject = "Congratulations! Welcome to Our Platform 🎉";
      message = `It's me again. ${verifiedUser.first_name}, i'm about to pop this grape juice,<br><br>
         Your account was successfully created and i can see our future with you in it, i'm so gassed.<br>
        You can now log in using either your email or phone number and the password you set during registration.<br><br>
        Thank you for joining us!<br><br>
        Best regards,<br>Sophia from The Admin Team`;

      // Send email
      await sendEmail(to, subject, message)
        .then((res) => res)
        .catch((err) => {
          console.error("Send Email Error:", err);
          return { success: false, error: err.message };
        });

      // Step 5: Respond with success
      res.status(200).json({
        success: true,
        message:
          "Verification successful. User registered and welcome email sent.",
        data: null,
      });
    } catch (error) {
      console.error("Verification error:", error);
      res.status(500).json({
        success: false,
        message: "Server error during email verification",
        data: null,
      });
    }
  })
);

// Login user /login
/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user
 *     description: Logs in a user with email and password.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - user_key
 *               - password
 *             properties:
 *               user_key:
 *                 type: string
 *                 example: user@example.com or 08012345678
 *               password:
 *                 type: string
 *                 example: password123
 *               remember_user:
 *                 type: boolean
 *                 example: true
 *                 default: false
 *     responses:
 *       200:
 *         description: User successful login
 *       400:
 *         description: Bad request (e.g., missing fields, wrong password)
 *       500:
 *         description: Server error during login
 */

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    try {
      const { password, remember_user } = req.body;
      let { user_key } = req.body;
      // user_key = email || phone_number;

      // Ensure at least one identifier
      if (!user_key || user_key.trim() === "") {
        return res.status(400).json({
          message: "Please provide either email or phone number",
          data: null,
        });
      }

      // Decide which table and column to use
      const identifier = user_key;
      const table = "users";

      if (!identifier || !password) {
        return res.status(400).json({
          message: "Please fill all fields",
          data: null,
        });
      }

      // Lookup by email OR phone_number
      // const result = await pool.query(
      //   `SELECT * FROM ${table} WHERE email = $1 OR phone_number = $1`,
      //   [identifier]
      // );

      const result = await prisma.users.findFirst({
        where: {
          OR: [{ email: identifier }, { phone_number: identifier }],
        },
      });

      if (result === null) {
        return res.status(400).json({
          message: "User not registered. Please sign up.",
          data: null,
        });
      }

      const user = result;
      // console.log(user);

      // Step 2: Compare password and admission number/email
      const isPasswordCorrect = await bcrypt.compare(password, user.password);

      if (!isPasswordCorrect) {
        return res.status(400).json({
          message: "Wrong password!",
          data: null,
        });
      }

      // validate email if identifier is email
      if (user_key.includes("@") && user.email !== user_key) {
        return res.status(400).json({
          message: "Please provide a valid email address.",
          data: null,
        });
      }

      // validate phone number if identifier is phone number
      if (!user_key.includes("@") && user.phone_number !== user_key) {
        return res.status(400).json({
          message: "Please provide a valid phone number.",
          data: null,
        });
      }

      // Step 3: Check for existing refresh token
      const userType = "users";

      // Step 4: Generate refresh/access token
      const { token: refreshToken, expiresAt } = generateRefreshToken(
        user.id,
        userType
      );

      const existingToken = await prisma.refresh_tokens.findFirst({
        where: {
          user_type: userType,
          user_id: user.id,
          purpose: `${userType} login`,
        },
        orderBy: {
          expires_at: "desc",
        },
        select: { id: true },
      });

      if (existingToken) {
        await prisma.refresh_tokens.update({
          where: { id: existingToken.id },
          data: {
            token: refreshToken,
            expires_at: expiresAt,
            revoked: false,
          },
        });
      } else {
        await prisma.refresh_tokens.create({
          data: {
            user_type: userType,
            user_id: user.id,
            token: refreshToken,
            expires_at: expiresAt,
            purpose: `${userType} login`,
          },
        });
      }

      // Cookie options
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "None",
        path: "/",
        // ...(remember_user && { maxAge: 30 * 24 * 60 * 60 * 1000 }),
      };

      if (remember_user) {
        cookieOptions.maxAge = 30 * 24 * 60 * 60 * 1000;
      }

      const accessToken = generateAccessToken(user.id, userType);

      res
        .status(200)
        .cookie("refreshToken", refreshToken, cookieOptions)
        .json({
          message: `User Login Successful`,
          data: {
            userType,
            ...accessToken,
            refreshToken,
          },
        });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        message: "Server error during login",
        data: null,
      });
    }
  })
);

// create / update password for users without/with password
/**
 * @swagger
 * /api/auth/create-password:
 *   post:
 *     summary: Create or update password.
 *     description: Create or update password for users without/with password.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - user_id
 *               - password
 *               - confirm_password
 *             properties:
 *               user_id:
 *                 type: integer
 *                 example: 1
 *               password:
 *                 type: string
 *                 example: password123
 *               confirm_password:
 *                 type: string
 *                 example: password123
 *     responses:
 *       200:
 *         description: Password Creation Successful
 *       400:
 *         description: Bad request (e.g., missing fields, wrong password)
 *       500:
 *         description: Server error during login
 */

router.post(
  "/create-password",
  asyncHandler(async (req, res) => {
    console.log(9876);
    const { user_type, user_id, password, confirm_password } = req.body;

    if (password !== confirm_password) {
      return res.status(400).json({ message: "Passwords don't match" });
    }

    if (!user_id || !password) {
      return res.status(400).json({ message: "Please fill all fields" });
    }

    try {
      // Check if student user_id exists

      const result = await prisma.users.findUnique({
        where: { id: user_id },
      });

      if (result === null) {
        return res.status(400).json({ error: "User not registered" });
      }

      // hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // update existing user with hashed password

      await prisma.users.update({
        where: { id: user_id },
        data: {
          password: hashedPassword,
          updated_at: new Date(),
        },
      });
      // return success message
      return res
        .status(200)
        .json({ message: "Password Creation Successful", data: null });
    } catch (error) {
      return res
        .status(500)
        .json({ message: "Server Error while creating password", data: null });
    }
  })
);

// START FROM HERE BELOW for swagger
// refresh token
/**
 * @swagger
 * /api/auth/refresh-token:
 *   post:
 *     summary: Refresh access token
 *     description: Generates a new access/refresh token using the refresh token stored in cookies.
 *     parameters:
 *       - in: cookie
 *         name: refreshToken
 *         schema:
 *           type: string
 *         required: true
 *         description: The refresh token stored in the user's cookies.
 *     responses:
 *       200:
 *         description: New access or refresh token successfully generated.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                   example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *       401:
 *         description: Invalid or expired refresh token.
 *       500:
 *         description: Server error during refresh token auth.
 */

router.post(
  "/refresh-token",
  asyncHandler(async (req, res) => {
    const refreshToken = req.cookies?.refreshToken;
    console.log(refreshToken);

    if (!refreshToken) {
      return res.status(401).json({ message: "No refresh token" });
    }

    try {
      // Verify the refresh token
      const decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET);

      console.log(decoded);
      console.log(decoded.role);
      // check for id from decoded token
      const tokens = await prisma.refresh_tokens.findFirst({
        where: {
          user_type: decoded.role,
          user_id: decoded.id,
        },
      });

      // if no id match
      if (tokens === null) {
        return res
          .status(401)
          .json({ message: "Refresh token not recognized" });
      }

      // Generate new refresh token
      const { token, expiresAt } = generateRefreshToken({ id: decoded.id });

      if (!token || typeof token !== "string") {
        console.log("Refresh token generation failed");
      }

      // Rotate: remove old token, insert new one
      await prisma.refresh_tokens.deleteMany({
        where: {
          user_type: decoded.role,
          user_id: decoded.id,
        },
      });

      await prisma.refresh_tokens.create({
        data: {
          token: token,
          user_type: decoded.role,
          user_id: decoded.id,
          expires_at: expiresAt,
          purpose: "renew",
        },
      });

      // Generate new access token
      const newAccessToken = generateAccessToken({
        id: decoded.id,
        role: decoded.role,
      });

      // Send tokens
      res
        .status(200)
        .cookie("refreshToken", token, {
          httpOnly: true,
          secure: false, // set to true in production with HTTPS
          sameSite: "Lax",
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        })
        .json({ accessToken: newAccessToken });
    } catch (error) {
      console.log(error);
      res
        .status(500)
        .json({ message: "Server error during refresh token auth." });
    }
  })
);

// forgot password
/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Forgot password.
 *     description: Send email for forgot password.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - user_type
 *               - email
 *             properties:
 *               user_type:
 *                 type: string
 *                 example: users
 *               email:
 *                 type: string
 *                 example: user@example.com
 *     responses:
 *       200:
 *         description: Password reset link sent.
 *       400:
 *         description: Bad request (e.g., Email not found)
 *       500:
 *         description: Server error during password reset
 */

router.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const { user_type, email } = req.body;

    try {
      const result = await prisma[user_type].findUnique({
        where: { email },
      });

      if (result === null) {
        return res.status(400).json({ message: "Email not found" });
      }

      const user = result;

      // Generate raw reset token
      const resetToken = jwt.sign(
        { id: user.id, user_type: user_type },
        process.env.JWT_SECRET,
        {
          expiresIn: "15m",
        }
      );

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      await prisma.refresh_tokens.create({
        data: {
          token: resetToken,
          user_type: user_type,
          user_id: user.id,
          expires_at: expiresAt,
          purpose: "forgot password",
        },
      });

      // Create reset URL with raw token
      const resetUrl = `http://localhost:4200/auth/reset-password?token=${resetToken}`;

      // Prepare email content
      let to, subject, message;

      to = email;
      subject = "Password Reset Request 🔐";
      message = `You are receiving this email because you requested a password reset. Click the link below to reset your password: <br><a href="${resetUrl}">${resetUrl}</a><br>Note: The link expires in 15 minutes! If you did not request this, please ignore this email.`;

      // Send email
      await sendEmail(to, subject, message)
        .then((res) => res)
        .catch((err) => {
          console.error("Send Email Error:", err);
          return { success: false, error: err.message };
        });

      res
        .status(200)
        .json({ message: "Password reset link sent.", data: null });
    } catch (error) {
      console.error(error);
      res
        .status(500)
        .json({ message: "Server error during password reset", data: null });
    }
  })
);

// reset password
/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Reset password.
 *     description: To successfully reset password.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - password
 *             properties:
 *               token:
 *                 type: string
 *                 example: 1920dnxsfwcwqhwe6w25272hwjnsa (representing JWT token)
 *               password:
 *                 type: string
 *                 example: password123
 *     responses:
 *       200:
 *         description: Password reset successful!.
 *       400:
 *         description: Bad request (e.g., Token not found)
 *       401:
 *         description: Unauthorized (e.g., Token expired or invalid)
 *       500:
 *         description: Server error during password reset.
 */

router.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const { token, password } = req.body;

    try {
      let decoded;

      // Step 1: Decode the JWT token (check expiry first)
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (err) {
        if (err.name === "TokenExpiredError") {
          return res.status(401).json({ message: "Token has expired" });
        }
        return res.status(400).json({ message: "Invalid token" });
      }

      // Step 2: Check if a matching token exists in DB and is unused

      const result = await prisma.refresh_tokens.findFirst({
        where: {
          user_type: decoded.user_type,
          user_id: decoded.id,
          purpose: "forgot password",
          revoked: false,
        },
        orderBy: {
          expires_at: "desc",
        },
      });

      if (result === null) {
        return res
          .status(400)
          .json({ message: "Token not found or already used", data: null });
      }

      const tokenData = result;
      // console.log(tokenData);

      // Step 3: Double-check token expiration in DB (extra safety)
      if (Date.now() > new Date(tokenData.expires_at).getTime() * 1000) {
        // console.log(Date.now());
        // console.log(tokenData.expires_at);
        // console.log(new Date(tokenData.expires_at).getTime());
        return res.status(401).json({ message: "Token has expired in DB" });
      }

      // Step 4: Compare provided token (raw) with hashed DB token
      if (token !== tokenData.token) {
        // console.log("Tokens match directly");
        return res.status(400).json({ message: "Invalid token" });
      }

      // Step 5: Hash new password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Step 6: Update school password
      await prisma[decoded.user_type].update({
        where: { id: decoded.id },
        data: { password: hashedPassword },
      });

      // Step 7: Mark token as used
      await prisma.refresh_tokens.update({
        where: { id: tokenData.id },
        data: { revoked: true },
      });

      res
        .status(200)
        .json({ message: "Password reset successful!", data: null });
    } catch (error) {
      console.error("Reset Password Error:", error);
      res
        .status(500)
        .json({ message: "Server error during password reset", data: null });
    }
  })
);

// Generate access token
const generateAccessToken = (id, role) => {
  const expiresIn = "30d";
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const accessToken = jwt.sign({ id, role }, process.env.ACCESS_SECRET, {
    expiresIn,
  });

  return { accessToken, expiresAt };
};

// Generate refresh token
const generateRefreshToken = (id, role) => {
  const expiresIn = "30d";
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const token = jwt.sign({ id, role }, process.env.REFRESH_SECRET, {
    expiresIn,
  });

  return { token, expiresAt };
};

module.exports = router;
