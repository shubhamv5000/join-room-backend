const express = require('express');
const router = express.Router();
const upload = require('../middleware/uploadMiddleware');
const { 
  signupUser, 
  loginUser, 
  sendResetOtp, 
  verifyOtpAndReset, 
  resetPasswordPhone 
} = require('../controllers/authController');

router.post('/signup', upload.single('profilePhoto'), signupUser);
router.post('/login', loginUser);
router.post('/forgot-password', sendResetOtp);
router.post('/reset-password', verifyOtpAndReset);
router.post('/reset-password-phone', resetPasswordPhone);

// UPDATE PROFILE PHOTO ANYTIME
router.put("/update-photo/:userId", upload.single("profilePhoto"), async (req, res) => {
  try {
    const { userId } = req.params;
    if (!req.file) {
      return res.status(400).json({ message: "Please select a photo first!" });
    }

    // यदि Cloudinary या Local uploads का उपयोग हो रहा है
    const photoUrl = req.file.path.startsWith("http")
      ? req.file.path
      : `http://localhost:5000/uploads/${req.file.filename}`;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { profilePhoto: photoUrl },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "Profile photo updated!",
      profilePhoto: updatedUser.profilePhoto
    });
  } catch (err) {
    console.error("Update Photo Error:", err);
    res.status(500).json({ message: "Failed to update profile photo" });
  }
});


module.exports = router;
