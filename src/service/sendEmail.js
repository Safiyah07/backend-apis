const nodemailer = require("nodemailer");

async function sendEmail(email, subject, text) {
  try {
    // Validate credentials before creating transporter
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      throw new Error(
        "Email credentials are not configured in environment variables"
      );
    }

    const transporter = nodemailer.createTransport({
      // Configure your email transport (e.g., SMTP details)
      service: "Gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
      // logger: true,
      // debug: true,
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject,
      html: text,
    };

    await transporter.sendMail(mailOptions);

    // const info = await transporter.sendMail(mailOptions);
    // return {
    //   success: true,
    //   messageId: info.messageId,
    // };
  } catch (error) {
    console.error("Email sending error:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = sendEmail;
