const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    chatType: { type: String, enum: ["room", "private"], required: true },
    messageType: { type: String, enum: ["text", "call"], default: "text" },
    status: { type: String, enum: ["sent", "delivered", "seen"], default: "sent" },
    roomID: { type: String },
    senderId: { type: String, required: true },
    receiverId: { type: String },
    senderName: { type: String, required: true },
    photo: { type: String },
    text: { type: String, required: true },
    callDetails: {
      callType: { type: String },
      duration: { type: String },
      status: { type: String }
    },
    time: { type: String, required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Message", messageSchema);
