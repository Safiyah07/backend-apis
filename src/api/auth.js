const express = require("express");
const router = express.Router();
const asyncHandler = require("express-async-handler");
const pool = require("../config/db");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const axios = require("axios");
const { authMiddleware } = require("../middleware/authMiddleware");

const generateSecureCode = (length = 4) => {
  return Math.random()
    .toString()
    .slice(2, 2 + length); // e.g. "4830"
};

const sendVerificationEmail = async (email, name, code) => {
  const mailPayload = {
    addresses: [email],
    subject: "Verify Your School's Email Address",
    content: `
      <p>Hello <b>${name}</b>,</p>
      <p>You're almost set! To confirm your email address, please use the verification code below:</p>
      <h2 style="color: #1a73e8;">${code}</h2>
      <p>This code will expire in 1 hour.</p>
      <br>
      <p>Thanks,<br/>The Admin Team</p>
    `,
    attachments: null,
  };

  await axios.post(process.env.MAIL_SERVICE_URL, mailPayload);
};

const RESEND_COOLDOWN_MINUTES = 2;

// send verification code for school registration
router.post(
  "/school/send-ver-code",
  asyncHandler(async (req, res) => {
    const {
      name,
      email,
      phone_number,
      address,
      school_reg_no,
      school_code,
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

    try {
      const schoolExists = await pool.query(
        "SELECT email FROM schools WHERE email = $1",
        [email]
      );
      if (schoolExists.rows.length > 0) {
        return res.status(400).json({
          message: "School already registered. Please log in.",
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

        await sendVerificationEmail(email, name, code);

        return res.json({
          message: "A new verification code has been sent to your email.",
        });
      }

      // Insert new pending verification
      await pool.query(
        `INSERT INTO verification_codes 
				(code_for, name, email, phone_number, address, school_reg_no, school_code, password, terms, code, expires_at, last_sent_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          "school",
          name,
          email,
          phone_number,
          address,
          school_reg_no,
          school_code,
          hashedPassword,
          terms,
          code,
          expiresAt,
          now,
        ]
      );

      await sendVerificationEmail(email, name, code);

      res.json({
        success: true,
        message: "Verification code sent successfully to your email or spam.",
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: "Server error during verification code sending",
      });
    }
  })
);

// compare verification code /api/compare-ver-code
router.post(
  "/school/compare-ver-code",
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

      const verifiedSchool = result.rows[0];

      // Step 2: Insert user data into `schools` table
      await pool.query(
        `INSERT INTO schools 
			(name, email, phone_number, address, school_reg_no, school_code, password, terms)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          verifiedSchool.name,
          verifiedSchool.email,
          verifiedSchool.phone_number,
          verifiedSchool.address,
          verifiedSchool.school_reg_no,
          verifiedSchool.school_code,
          verifiedSchool.password,
          verifiedSchool.terms,
        ]
      );

      // Step 3: Delete the used verification code
      await pool.query(`DELETE FROM verification_codes WHERE id = $1`, [
        verifiedSchool.id,
      ]);

      // Step 4: Send welcome email
      const mailPayload = {
        addresses: [verifiedSchool.email],
        subject: "Welcome to Our Platform 🎉",
        content: `Hi ${verifiedSchool.name},<br><br>
        Your school has been successfully registered on our platform.<br>
        You can now log in and start using the services.<br><br>
        Thank you for joining us!<br><br>
        Best regards,<br>The Team`,
        attachments: null,
      };

      axios
        .post(process.env.MAIL_SERVICE_URL, mailPayload)
        .catch((error) =>
          console.error("Welcome email failed:", error.message)
        );

      // Step 5: Respond with success
      res.json({
        success: true,
        message:
          "Verification successful. School registered and welcome email sent.",
      });
    } catch (error) {
      console.error("Verification error:", error);
      res
        .status(500)
        .json({ success: false, message: "Server error during verification" });
    }
  })
);

// Login school /api/school/login
router.post(
  "/school/login",
  asyncHandler(async (req, res) => {
    try {
      const { school_code, password, remember_user } = req.body;

      if (!school_code || !password) {
        return res.status(400).json({ error: "Please fill all fields" });
      }

      // Step 1: Find school by school_code

      // await pool.query("SET search_path TO public2");
      const result = await pool.query(
        "SELECT * FROM schools WHERE school_code = $1",
        [school_code]
      );
      if (!result.rows.length) {
        return res.status(400).json({ error: "School code doesn't exist" });
      }

      const school = result.rows[0];

      // Step 2: Compare passwords
      const isMatch = await bcrypt.compare(password, school.password);
      if (!isMatch) {
        return res.status(400).json({ error: "Invalid credentials" });
      }

      // Step 3: Generate refresh/access token
      const { token: refreshToken, expiresAt } = generateRefreshToken(
        school.id,
        school.role
      );

      // Optional expiry check
      const now = new Date();
      if (expiresAt < now) {
        return res
          .status(403)
          .json({ message: "Not authorized, token expired" });
      }

      // Step 4: Check for existing refresh token
      const existingToken = await pool.query(
        `SELECT id FROM refresh_tokens 
			 WHERE school_id = $1 AND purpose = $2
			 ORDER BY expires_at DESC LIMIT 1`,
        [school.id, "school login"]
      );

      if (existingToken.rows.length > 0) {
        // Update existing token
        await pool.query(
          `UPDATE refresh_tokens
				 SET token = $1, expires_at = $2, used = false
				 WHERE id = $3`,
          [refreshToken, expiresAt, existingToken.rows[0].id]
        );
      } else {
        // Insert new token
        await pool.query(
          `INSERT INTO refresh_tokens (token, school_id, expires_at, purpose)
				 VALUES ($1, $2, $3, $4)`,
          [refreshToken, school.id, expiresAt, "login"]
        );
      }

      // Step 5: Setup cookie options
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "None",
        path: "/",
      };

      if (remember_user) {
        cookieOptions.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
      }

      // Step 6: Generate access token
      const accessToken = generateAccessToken(school.id, school.role);

      // Step 7: Send response
      res.status(200).cookie("refreshToken", refreshToken, cookieOptions).json({
        message: "School Login Successful",
        accessToken,
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Server error during login" });
    }
  })
);

// password creation for teacher and student
router.post(
  "/auth/create-password",
  asyncHandler(async (req, res) => {
    const { user_type, user_id, password, confirm_password } = req.body;

    if (password !== confirm_password) {
      return res.status(400).json({ message: "Passwords don't match" });
    }

    if (!user_id || !password) {
      return res.status(400).json({ message: "Please fill all fields" });
    }

    try {
      if (user_type === "teacher") {
        // Check if teacher user_id exists
        const result = await pool.query(
          "SELECT * FROM teachers WHERE id = $1",
          [user_id]
        );

        if (result.rows.length === 0) {
          return res.status(400).json({ error: "Teacher not registered" });
        }

        // hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // update existing teacher with hashed password
        await pool.query(`UPDATE teachers SET password = $1 WHERE id = $2`, [
          hashedPassword,
          user_id,
        ]);
      }
      if (user_type === "student") {
        // Check if student user_id exists
        const result = await pool.query(
          "SELECT * FROM students WHERE id = $1",
          [user_id]
        );

        if (result.rows.length === 0) {
          return res.status(400).json({ error: "Student not registered" });
        }

        // hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // update existing teacher with hashed password
        await pool.query(`UPDATE students SET password = $1 WHERE id = $2`, [
          hashedPassword,
          user_id,
        ]);
      }

      // return success message
      return res
        .status(200)
        .json({ message: "Password Creation Successful", data: null });
    } catch (error) {
      return res.status(500).json({ message: "Server Error", data: null });
    }
  })
);

// sign up student /api/student/signup
router.post(
  "/participant/signup",
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

    if (password !== confirm_password) {
      return res.status(400).json({ message: "Passwords do not match." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    try {
      const studentExists = await pool.query(
        "SELECT email FROM participants WHERE email = $1",
        [email]
      );
      if (studentExists.rows.length > 0) {
        return res
          .status(400)
          .json({ message: "Student already registered. Please log in." });
      }

      // generate unique participant_id
      let unique = false;
      let participant_id;
      while (!unique) {
        participant_id = `S${Math.floor(100000 + Math.random() * 900000)}`; // e.g. S123456
        const idCheck = await pool.query(
          "SELECT participant_id FROM participants WHERE participant_id = $1",
          [participant_id]
        );
        if (idCheck.rows.length === 0) {
          unique = true;
        }
      }

      // insert new student into database
      const user = await pool.query(
        `INSERT INTO participants 
          (participant_id, avatar_url, first_name, middle_name, last_name, email, phone_number, password)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *
        `,
        [
          participant_id,
          avatar_url,
          first_name,
          middle_name,
          last_name,
          email,
          phone_number,
          hashedPassword,
        ]
      );

      const userType = "participants";

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
          `INSERT INTO refresh_tokens (user_type, user_id, token,          expires_at, purpose)
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

      const accessToken = generateAccessToken(user.id, userType);

      const mailPayload = {
        addresses: [email],
        subject: "Nova Quiz Account Created 🎉",
        content: `Hi ${first_name},<br><br>
        Your student account has been successfully created on Nova Quiz.<br>
        You can now log in using either your email or phone number and the password you set during registration.<br><br>
        Thank you for joining us!<br><br>
        Best regards,<br>The Nova Quiz Team`,
        attachments: null,
      };

      const mailResponse = await axios.post(
        process.env.MAIL_SERVICE_URL,
        mailPayload
      );

      console.log("Mail Service Response:", mailResponse.status);
      res.status(201).json({
        message: "Registered successfully, redirecting to dashboard...",
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

// change participant password
router.post(
  "/participant/change-password",
  authMiddleware(),
  asyncHandler(async (req, res) => {
    const { password } = req.body;
    const { id } = req.user;

    if (!id || !password) {
      return res
        .status(400)
        .json({ message: "Participant ID and password required" });
    }

    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Update DB
    const updateQuery = `
      UPDATE participants 
      SET password = $1 
      WHERE id = $2 
      RETURNING id, email
    `;

    const result = await pool.query(updateQuery, [hashedPassword, id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Participant not found" });
    }

    res
      .status(200)
      .json({ message: "Password updated successfully", user: result.rows[0] });
  })
);

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

      // Hash the token
      // const salt = await bcrypt.genSalt(10);
      // const hashedToken = await bcrypt.hash(resetToken, salt);

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
