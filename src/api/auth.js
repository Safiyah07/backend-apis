const express = require("express");
const router = express.Router();
const asyncHandler = require("express-async-handler");
const pool = require("../config/db");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const axios = require("axios");
const { authMiddleware } = require("../middleware/authMiddleware");
const sendEmail = require("../service/sendEmail");
const e = require("express");

const generateSecureCode = (length = 4) => {
  return Math.random()
    .toString()
    .slice(2, 2 + length); // e.g. "4830"
};

const RESEND_COOLDOWN_MINUTES = 2;

// sign up user and send email
router.post(
  "/signup",
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
      // check if user exists
      const userExists = await pool.query(
        "SELECT email FROM users WHERE email = $1",
        [email]
      );
      if (userExists.rows.length > 0) {
        return res
          .status(400)
          .json({ message: "User already registered. Please log in." });
      }

      // generate unique user_code
      let unique = false;
      let user_code;
      while (!unique) {
        user_code = `S${Math.floor(100000 + Math.random() * 900000)}`; // e.g. S123456
        const idCheck = await pool.query(
          "SELECT id FROM users WHERE user_code = $1",
          [user_code]
        );
        if (idCheck.rows.length === 0) {
          unique = true;
        }
      }

      // insert new student into database
      const user = await pool.query(
        `INSERT INTO users 
          (user_code, avatar_url, first_name, middle_name, last_name, email, phone_number, password)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *
        `,
        [
          user_code,
          avatar_url,
          first_name,
          middle_name,
          last_name,
          email,
          phone_number,
          hashedPassword,
        ]
      );

      const userType = "user";

      // console.log(user.rows[0]);
      const newUser = user.rows[0];

      // Step 4: Generate refresh/access token
      const { token: refreshToken, expiresAt } = generateRefreshToken(
        newUser.id,
        userType
      );

      const existingToken = await pool.query(
        `SELECT id FROM refresh_tokens 
          WHERE user_type = $1 AND user_id = $2 AND purpose = $3
          ORDER BY expires_at DESC LIMIT 1
        `,
        [userType, newUser.id, `${userType} login`]
      );

      if (existingToken.rows.length > 0) {
        await pool.query(
          `UPDATE refresh_tokens
            SET token = $1, expires_at = $2, revoked = false
            WHERE id = $3
          `,
          [refreshToken, expiresAt, existingToken.rows[0].id]
        );
      } else {
        await pool.query(
          `INSERT INTO refresh_tokens (user_type, user_id, token, expires_at, purpose)
          VALUES ($1, $2, $3, $4, $5)`,
          [userType, newUser.id, refreshToken, expiresAt, `${userType} login`]
        );
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
        message: "Registration successful!",
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
      const userExists = await pool.query(
        "SELECT email FROM users WHERE email = $1",
        [email]
      );
      if (userExists.rows.length > 0) {
        return res.status(400).json({
          message: "User already registered. Please log in.",
        });
      }

      const verificationResult = await pool.query(
        "SELECT * FROM verification_codes WHERE email = $1",
        [email]
      );

      if (verificationResult.rows.length > 0) {
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
        await pool.query(
          `UPDATE verification_codes 
				SET code = $1, expires_at = $2, last_sent_at = $3
				WHERE email = $4`,
          [code, expiresAt, now, email]
        );

        // Send email
        await sendEmail(to, subject, message)
          .then((res) => res)
          .catch((err) => {
            console.error("Send Email Error:", err);
            return { success: false, error: err.message };
          });

        return res.json({
          message: "A new verification code has been sent to your email.",
        });
      }

      // Insert new pending verification
      await pool.query(
        `INSERT INTO verification_codes 
				(code_for, first_name, middle_name, last_name, email, phone_number, password, terms, code, expires_at, last_sent_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          "signup with code",
          first_name,
          middle_name,
          last_name,
          email,
          phone_number,
          hashedPassword,
          terms,
          code,
          expiresAt,
          now,
        ]
      );

      // Send email
      await sendEmail(to, subject, message)
        .then((res) => res)
        .catch((err) => {
          console.error("Send Email Error:", err);
          return { success: false, error: err.message };
        });

      res.json({
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
router.post(
  "/compare-ver-code",
  asyncHandler(async (req, res) => {
    const { email, code: userCode } = req.body;

    try {
      // Step 1: Check for a valid, unused, unexpired verification code
      const result = await pool.query(
        `SELECT * FROM verification_codes 
			 WHERE email = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()`,
        [email, userCode]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ error: "Invalid or expired code" });
      }

      const verifiedUser = result.rows[0];
      console.log(verifiedUser);

      // generate unique user_code
      let unique = false;
      let user_code;
      while (!unique) {
        user_code = `S${Math.floor(100000 + Math.random() * 900000)}`; // e.g. S123456
        const idCheck = await pool.query(
          "SELECT id FROM users WHERE user_code = $1",
          [user_code]
        );
        if (idCheck.rows.length === 0) {
          unique = true;
        }
      }

      // Step 2: Insert user data into `schools` table
      await pool.query(
        `INSERT INTO users 
			(first_name, middle_name, last_name, email, phone_number, user_code, password, terms)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          verifiedUser.first_name,
          verifiedUser.middle_name,
          verifiedUser.last_name,
          verifiedUser.email,
          verifiedUser.phone_number,
          user_code,
          verifiedUser.password,
          verifiedUser.terms,
        ]
      );

      // Step 3: Delete the used verification code
      await pool.query(`DELETE FROM verification_codes WHERE id = $1`, [
        verifiedUser.id,
      ]);

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
      res.json({
        success: true,
        message:
          "Verification successful. User registered and welcome email sent.",
      });
    } catch (error) {
      console.error("Verification error:", error);
      res
        .status(500)
        .json({ success: false, message: "Server error during verification" });
    }
  })
);

// Login user /login
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
          message:
            "Authentication failed, Please provide either email or phone number",
          data: null,
        });
      }

      // Decide which table and column to use
      const identifier = user_key;
      const table = "users";

      if (!identifier || !password) {
        return res.status(400).json({
          message: "Authentication failed, Please fill all fields",
          data: null,
        });
      }

      // Lookup by email OR phone_number
      const result = await pool.query(
        `SELECT * FROM ${table} WHERE email = $1 OR phone_number = $1`,
        [identifier]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({
          message: "Authentication failed, User details not registered",
          data: null,
        });
      }

      const user = result.rows[0];
      // console.log(user);

      // Step 2: Compare password and admission number/email
      const isPasswordCorrect = await bcrypt.compare(password, user.password);

      if (!isPasswordCorrect) {
        return res.status(400).json({
          message: "Authentication failed, Invalid credentials",
          data: null,
        });
      }

      // Now validate identifier against the right column
      if (user.email !== user_key && user.phone_number !== user_key) {
        return res.status(400).json({
          message: "Authentication failed, Invalid credentials",
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

      const existingToken = await pool.query(
        `SELECT id FROM refresh_tokens 
          WHERE user_type = $1 AND user_id = $2 AND purpose = $3
          ORDER BY expires_at DESC LIMIT 1
        `,
        [userType, user.id, `${userType} login`]
      );

      if (existingToken.rows.length > 0) {
        await pool.query(
          `UPDATE refresh_tokens
            SET token = $1, expires_at = $2, revoked = false
            WHERE id = $3
          `,
          [refreshToken, expiresAt, existingToken.rows[0].id]
        );
      } else {
        await pool.query(
          `INSERT INTO refresh_tokens (user_type, user_id, token, expires_at, purpose)
          VALUES ($1, $2, $3, $4, $5)`,
          [userType, user.id, refreshToken, expiresAt, `${userType} login`]
        );
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
        message: "Authentication failed",
        data: null,
      });
    }
  })
);

// create / update password for users without/with password
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
      const result = await pool.query("SELECT * FROM users WHERE id = $1", [
        user_id,
      ]);

      if (result.rows.length === 0) {
        return res.status(400).json({ error: "User not registered" });
      }

      // hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // update existing user with hashed password
      await pool.query(
        `UPDATE users SET password = $1, updated_at = $2 WHERE id = $3`,
        [hashedPassword, new Date(), user_id]
      );

      // return success message
      return res
        .status(200)
        .json({ message: "Password Creation Successful", data: null });
    } catch (error) {
      return res.status(500).json({ message: "Server Error", data: null });
    }
  })
);

// START FROM HERE BELOW
// refresh token
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
      const tokens = await pool.query(
        "SELECT * FROM refresh_tokens WHERE user_type = $1 AND user_id = $2",
        [decoded.role, decoded.id]
      );

      // if no id match
      if (tokens.rowCount === 0) {
        return res
          .status(403)
          .json({ message: "Refresh token not recognized" });
      }

      // Generate new refresh token
      const { token, expiresAt } = generateRefreshToken({ id: decoded.id });

      if (!token || typeof token !== "string") {
        console.log("Refresh token generation failed");
      }

      // const hashedNew = await bcrypt.hash(token, 10);

      // Rotate: remove old token, insert new one
      await pool.query(
        "DELETE FROM refresh_tokens WHERE user_type = $1 AND user_id = $2",
        [decoded.role, decoded.id]
      );

      await pool.query(
        `INSERT INTO refresh_tokens (token, user_type, user_id, expires_at, purpose) VALUES($1, $2, $3, $4, $5)`,
        [token, decoded.role, decoded.id, expiresAt, "renew"]
      );

      // Generate new access token
      const newAccessToken = generateAccessToken({
        id: decoded.id,
        role: decoded.role,
      });

      // Send tokens
      res
        .cookie("refreshToken", token, {
          httpOnly: true,
          secure: false, // set to true in production with HTTPS
          sameSite: "Lax",
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        })
        .json({ accessToken: newAccessToken });
    } catch (error) {
      console.log(error);
      res.status(403);
      throw new Error(error);
    }
  })
);

// forgot password
router.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const { user_type, email } = req.body;

    try {
      const result = await pool.query(
        `SELECT * FROM ${user_type} WHERE email = $1`,
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ message: "Email not found" });
      }

      const user = result.rows[0];

      // Generate raw reset token
      const resetToken = jwt.sign(
        { id: user.id, user_type: user_type },
        process.env.JWT_SECRET,
        {
          expiresIn: "15m",
        }
      );

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      await pool.query(
        `INSERT INTO refresh_tokens (token, user_type, user_id, expires_at, purpose)
			 VALUES ($1, $2, $3, $4, $5)`,
        [resetToken, user_type, user.id, expiresAt, "forgot password"]
      );

      console.log("you are here");

      // Create reset URL with raw token
      const resetUrl = `http://localhost:4200/auth/reset-password?token=${resetToken}`;

      const mailPayload = {
        addresses: [email],
        subject: "Password Reset",
        content: `You are receiving this email because you requested a password reset. Click the link below to reset your password: <br><a href="${resetUrl}">${resetUrl}</a><br>The link expires in 15 minutes! If you did not request this, please ignore this email.`,
        attachments: null,
      };

      const mailResponse = await axios.post(
        process.env.MAIL_SERVICE_URL,
        mailPayload
      );

      console.log("Mail Service Response:", mailResponse.status);

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
      const result = await pool.query(
        `SELECT * FROM refresh_tokens 
			 WHERE user_type = $1 AND user_id = $2 AND purpose = $3 AND revoked = FALSE 
			 ORDER BY expires_at DESC LIMIT 1`,
        [decoded.user_type, decoded.id, "forgot password"]
      );

      if (result.rows.length === 0) {
        return res
          .status(401)
          .json({ message: "Token not found or already used", data: null });
      }

      const tokenData = result.rows[0];
      // console.log(tokenData);

      // Step 3: Double-check token expiration in DB (extra safety)
      if (Date.now() > new Date(tokenData.expires_at).getTime() * 1000) {
        // console.log(Date.now());
        // console.log(tokenData.expires_at);
        // console.log(new Date(tokenData.expires_at).getTime());
        return res.status(400).json({ message: "Token has expired in DB" });
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
      await pool.query(
        `UPDATE ${decoded.user_type} SET password = $1 WHERE id = $2`,
        [hashedPassword, decoded.id]
      );

      // Step 7: Mark token as used
      await pool.query(
        "UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1",
        [tokenData.id]
      );

      res
        .status(200)
        .json({ message: "Password reset successful!", data: null });
    } catch (error) {
      console.error("Reset Password Error:", error);
      res.status(500).json({ message: "Server error", data: null });
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
