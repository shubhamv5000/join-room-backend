const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGOURI);
    console.log('🚀 MongoDB Atlas Connected!');
  } catch (err) {
    console.error('❌ DB Error:', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
