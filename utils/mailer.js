const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.ethereal.email',
  port: process.env.EMAIL_PORT || 587,
  secure: process.env.EMAIL_PORT == '465', // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USERNAME,
    pass: process.env.EMAIL_PASSWORD
  }
});

const sendVerificationEmail = async (to, code, magicLink, isReset = false) => {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  const subject = isReset ? 'Reset Your Password' : 'Verify Your Account';
  
  const html = `
    <h2>${isReset ? 'Reset Your Password' : 'Welcome to Athlon!'}</h2>
    <p>Please use the following 6-digit code to ${isReset ? 'reset your password' : 'verify your account'}:</p>
    <h3>${code}</h3>
    <p>Or click the magic link below (valid for 1 use and must match your IP address):</p>
    <a href="${magicLink}">${magicLink}</a>
    <p>This link and code will expire in 15 minutes.</p>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"Athlon Security" <${process.env.EMAIL_USERNAME}>`,
      to,
      subject,
      html
    });
    console.log('Message sent: %s', info.messageId);
    if (process.env.NODE_ENV !== 'production' && !process.env.EMAIL_HOST) {
      console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
    }
  } catch (error) {
    console.error('Error sending email:', error);
  }
};

module.exports = {
  sendVerificationEmail
};
