
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const https = require('https');
const dns = require('dns');

// Windows पर Google API से कनेक्शन फेल होने से बचाने के लिए IPv4 को प्राथमिकता दें
dns.setDefaultResultOrder('ipv4first');

// 1. SIGNUP
exports.signupUser = async (req, res) => {
  const { name, email, phone, password } = req.body;
  try {
    const exists = await User.findOne({ $or: [{ email }, { phone }] });
    if (exists) return res.status(400).json({ message: 'Email or Phone already registered!' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const photoUrl = req.file ? `http://localhost:5000/uploads/${req.file.filename}` : undefined;

    const newUser = new User({ name, email, phone, password: hashedPassword, profilePhoto: photoUrl });
    await newUser.save();

    res.status(201).json({ message: 'Signup Successful! Please Login.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 2. DUAL LOGIN (EMAIL OR PHONE)
exports.loginUser = async (req, res) => {
  const { identifier, password } = req.body;
  try {
    const user = await User.findOne({ $or: [{ email: identifier }, { phone: identifier }] });
    if (!user) return res.status(404).json({ message: 'User not found!' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid Password!' });

    const secret = process.env.JWT_SECRET || 'NEXUS_SUPER_SECRET_KEY_2026';
    const token = jwt.sign({ id: user._id }, secret, { expiresIn: '1d' });

    res.status(200).json({
      token,
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, profilePhoto: user.profilePhoto }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 3. SEND 6-DIGIT NUMERIC OTP (SECURE EMAIL ONLY)
exports.sendResetOtp = async (req, res) => {
  const { identifier } = req.body;
  try {
    const user = await User.findOne({ $or: [{ email: identifier }, { phone: identifier }] });
    if (!user) return res.status(404).json({ message: 'No account found with this Email or Phone!' });

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res.status(500).json({ message: 'Server email configuration is missing in .env file!' });
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    user.resetOtp = otp;
    user.resetOtpExpiry = Date.now() + 10 * 60 * 1000;
    await user.save();

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: `"NexusChat Security" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'NexusChat 6-Digit Password Reset OTP',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: #09090B; color: #ffffff; border-radius: 10px;">
          <h2 style="color: #6366f1;">NexusChat Password Reset</h2>
          <p>Aapke account ka password reset karne ke liye 6-digit OTP niche diya gaya hai:</p>
          <h1 style="letter-spacing: 5px; color: #22d3ee; background: #18181b; padding: 10px 20px; display: inline-block; border-radius: 8px;">${otp}</h1>
          <p style="font-size: 12px; color: #a1a1aa;">Yeh OTP 10 minute tak valid hai. Agar aapne yeh request nahi ki hai, toh is email ko ignore karein.</p>
        </div>
      `
    });

    res.status(200).json({
      message: `6-Digit OTP has been sent to your registered email (${user.email})!`
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to send email: ' + err.message });
  }
};

// 4. VERIFY 6-DIGIT OTP & RESET PASSWORD
exports.verifyOtpAndReset = async (req, res) => {
  const { identifier, otp, newPassword } = req.body;
  try {
    const user = await User.findOne({ $or: [{ email: identifier }, { phone: identifier }] });
    if (!user) return res.status(404).json({ message: 'User not found!' });

    if (!user.resetOtp || user.resetOtp !== otp) {
      return res.status(400).json({ message: 'Invalid 6-Digit OTP!' });
    }

    if (user.resetOtpExpiry < Date.now()) {
      return res.status(400).json({ message: 'OTP expired! Request a new one.' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetOtp = undefined;
    user.resetOtpExpiry = undefined;
    await user.save();

    res.status(200).json({ message: 'Password reset successful! Please login.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Helper function to verify Firebase token safely
// Helper function to verify Firebase token safely
const verifyFirebaseToken = (idToken, apiKey) => {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ idToken });
    
    // Hostname को दो भागों में जोड़कर लिख रहे हैं ताकि कॉपी-पेस्ट में यह कभी न कटे
    const googleHost = ['identitytoolkit', 'googleapis', 'com'].join('.');
    
    const options = {
      hostname: googleHost,
      path: '/v1/accounts:lookup?key=' + apiKey,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            data: JSON.parse(body)
          });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(postData);
    req.end();
  });
};

// 5. VERIFY FIREBASE PHONE OTP & RESET PASSWORD
exports.resetPasswordPhone = async (req, res) => {
  const { firebaseToken, newPassword } = req.body;
  const FIREBASE_WEB_API_KEY = "AIzaSyAYlWOAGzN6Ys1q94t3J8LJ6m81I7CeNVo";

  if (!firebaseToken || !newPassword) {
    return res.status(400).json({ message: 'Firebase token and new password are required!' });
  }

  try {
    // 1. Verify Firebase Token
    const { ok, data } = await verifyFirebaseToken(firebaseToken, FIREBASE_WEB_API_KEY);

    if (!ok || !data.users || data.users.length === 0) {
      return res.status(401).json({ message: 'Invalid or expired OTP token!' });
    }

    // 2. Extract verified phone number
    const verifiedPhone = data.users[0].phoneNumber;

    if (!verifiedPhone) {
      return res.status(400).json({ message: 'Phone number could not be verified!' });
    }

    // 3. Find user in DB (Matches both "+919876543210" and "9876543210")
    const phoneWithoutCode = verifiedPhone.replace('+91', '');
    const user = await User.findOne({
      $or: [{ phone: verifiedPhone }, { phone: phoneWithoutCode }]
    });

    if (!user) {
      return res.status(404).json({ message: `No account found with phone: ${phoneWithoutCode}` });
    }

    // 4. Hash and update password
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.status(200).json({ message: 'Password reset via phone successful! Please login.' });
  } catch (err) {
    console.error("Reset Password Phone Error:", err);
    res.status(500).json({ message: 'Server error: ' + err.message });
  }
};
