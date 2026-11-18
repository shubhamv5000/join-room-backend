const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");
const Message = require("./models/Message");
const User = require("./models/User");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 20000,
  pingInterval: 10000
});

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

mongoose
  .connect(process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/nexuschat")
  .then(() => console.log("MongoDB Connected Successfully"))
  .catch((err) => console.error("MongoDB Connection Error:", err));

app.use("/api/auth", authRoutes);

// UPDATE PROFILE PHOTO ANYTIME (Zero Conflict Route)
app.put("/api/users/update-photo/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { profilePhoto } = req.body;

    if (!profilePhoto) {
      return res.status(400).json({ message: "No photo data received!" });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { profilePhoto },
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
    console.error("Photo Update Error:", err);
    res.status(500).json({ message: err.message });
  }
});

const roomUsers = {};
const onlineUsers = {};

// 1. ALL USERS API
app.get("/api/users", async (req, res) => {
  try {
    const users = await User.find({}, "_id name profilePhoto");
    const formattedUsers = users.map((u) => ({
      id: u._id.toString(),
      name: u.name,
      photo: u.profilePhoto || "https://placeholder.com"
    }));
    res.status(200).json(formattedUsers);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

// 2. PRIVATE CHAT HISTORY API
app.get("/api/messages/private/:user1/:user2", async (req, res) => {
  try {
    const user1 = String(req.params.user1).trim();
    const user2 = String(req.params.user2).trim();
    const messages = await Message.find({
      $or: [
        { senderId: user1, receiverId: user2 },
        { senderId: user2, receiverId: user1 }
      ]
    }).sort({ createdAt: 1 });
    res.status(200).json(messages);
  } catch (err) {
    res.status(500).json({ message: "Failed to load private chat history" });
  }
});

// 3. CALL HISTORY API
app.get("/api/calls/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const calls = await Message.find({
      messageType: "call",
      $or: [{ senderId: userId }, { receiverId: userId }]
    }).sort({ createdAt: -1 });
    res.status(200).json(calls);
  } catch (err) {
    res.status(500).json({ message: "Failed to load call history" });
  }
});

// 4. DELETE SINGLE MESSAGE API
app.delete("/api/messages/:messageId", async (req, res) => {
  try {
    const { messageId } = req.params;
    const deleted = await Message.findByIdAndDelete(messageId);
    if (deleted) {
      if (deleted.chatType === "room" && deleted.roomID) {
        io.to(deleted.roomID).emit("messageDeleted", messageId);
      } else if (deleted.chatType === "private") {
        const s1 = onlineUsers[deleted.senderId];
        const s2 = onlineUsers[deleted.receiverId];
        if (s1) io.to(s1).emit("messageDeleted", messageId);
        if (s2) io.to(s2).emit("messageDeleted", messageId);
      }
    }
    res.status(200).json({ message: "Message deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete message" });
  }
});

// 5. CLEAR ENTIRE PRIVATE CHAT API
app.delete("/api/messages/private/clear/:user1/:user2", async (req, res) => {
  try {
    const { user1, user2 } = req.params;
    await Message.deleteMany({
      chatType: "private",
      $or: [
        { senderId: user1, receiverId: user2 },
        { senderId: user2, receiverId: user1 }
      ]
    });
    const s1 = onlineUsers[user1];
    const s2 = onlineUsers[user2];
    if (s1) io.to(s1).emit("chatCleared", { chatType: "private", user1, user2 });
    if (s2) io.to(s2).emit("chatCleared", { chatType: "private", user1, user2 });
    res.status(200).json({ message: "Private chat cleared" });
  } catch (err) {
    res.status(500).json({ message: "Failed to clear private chat" });
  }
});

// 6. CLEAR ENTIRE ROOM CHAT API
app.delete("/api/messages/room/clear/:roomID", async (req, res) => {
  try {
    const { roomID } = req.params;
    await Message.deleteMany({ chatType: "room", roomID });
    io.to(roomID).emit("chatCleared", { chatType: "room", roomID });
    res.status(200).json({ message: "Room chat cleared" });
  } catch (err) {
    res.status(500).json({ message: "Failed to clear room chat" });
  }
});

setInterval(() => {
  const activeIds = new Set();
  for (const [, s] of io.of("/").sockets) {
    if (s.userId) activeIds.add(String(s.userId));
  }
  io.emit("onlineUsersList", Array.from(activeIds));
}, 3000);
io.on("connection", (socket) => {
  socket.on("registerUser", async (userId) => {
    if (userId) {
      socket.userId = String(userId);
      onlineUsers[String(userId)] = socket.id;
      io.emit("onlineUsersList", Object.keys(onlineUsers));

      try {
        await Message.updateMany(
          { chatType: "private", receiverId: String(userId), status: "sent" },
          { $set: { status: "delivered" } }
        );
        io.emit("messagesDelivered", { toUserId: String(userId) });
      } catch (err) {
        console.error("Update Delivered Error:", err);
      }
    }
  });

  socket.on("joinRoom", async ({ roomID, user }) => {
    if (!roomID || !user) return;
    socket.join(roomID);
    socket.roomID = roomID;
    socket.userId = String(user.id);
    onlineUsers[String(user.id)] = socket.id;
    io.emit("onlineUsersList", Object.keys(onlineUsers));

    if (!roomUsers[roomID]) roomUsers[roomID] = [];
    roomUsers[roomID] = roomUsers[roomID].filter((u) => u.id !== user.id);

    roomUsers[roomID].push({
      id: user.id,
      name: user.name,
      photo: user.profilePhoto || "https://placeholder.com",
      socketId: socket.id,
      roomID
    });

    io.to(roomID).emit("roomData", { room: roomID, users: roomUsers[roomID] });

    try {
      const history = await Message.find({ chatType: "room", roomID }).sort({ createdAt: 1 });
      socket.emit("roomHistory", history);
    } catch (err) {
      console.error("Room History Error:", err);
    }
  });

  socket.on("sendMessage", async ({ roomID, messageData }) => {
    if (!roomID || !messageData) return;
    try {
      const savedMsg = await Message.create({ chatType: "room", roomID, ...messageData });
      io.to(roomID).emit("message", savedMsg);
    } catch (err) {
      console.error("Save Room Message Error:", err);
    }
  });

  socket.on("sendPrivateMessage", async ({ receiverId, messageData }) => {
    if (!messageData || !receiverId) return;
    try {
      const targetSocket = onlineUsers[String(receiverId)];
      const initialStatus = targetSocket ? "delivered" : "sent";

      const savedMsg = await Message.create({
        chatType: "private",
        receiverId: String(receiverId),
        status: initialStatus,
        ...messageData
      });

      if (targetSocket) {
        io.to(targetSocket).emit("privateMessage", savedMsg);
      }
      socket.emit("privateMessageSaved", savedMsg);
    } catch (err) {
      console.error("Save Private Message Error:", err);
    }
  });

  socket.on("markMessagesSeen", async ({ senderId, receiverId }) => {
    if (!senderId || !receiverId) return;
    try {
      await Message.updateMany(
        { chatType: "private", senderId, receiverId, status: { $ne: "seen" } },
        { $set: { status: "seen" } }
      );
      const senderSocket = onlineUsers[senderId];
      if (senderSocket) {
        io.to(senderSocket).emit("messagesMarkedSeen", { byUserId: receiverId });
      }
    } catch (err) {
      console.error("Mark Seen Error:", err);
    }
  });

  socket.on("typing", ({ chatType, roomID, receiverId, senderId, senderName }) => {
    if (chatType === "room" && roomID) {
      socket.to(roomID).emit("userTyping", { chatType: "room", roomID, senderId, senderName });
    } else if (chatType === "private" && receiverId) {
      const targetSocket = onlineUsers[receiverId];
      if (targetSocket) {
        io.to(targetSocket).emit("userTyping", { chatType: "private", senderId, senderName });
      }
    }
  });

  socket.on("stopTyping", ({ chatType, roomID, receiverId, senderId }) => {
    if (chatType === "room" && roomID) {
      socket.to(roomID).emit("userStopTyping", { chatType: "room", roomID, senderId });
    } else if (chatType === "private" && receiverId) {
      const targetSocket = onlineUsers[receiverId];
      if (targetSocket) {
        io.to(targetSocket).emit("userStopTyping", { chatType: "private", senderId });
      }
    }
  });

  socket.on("callUser", async ({ userToCall, signalData, from, name, photo, callType }) => {
    const targetSocket = onlineUsers[userToCall];
    if (targetSocket) {
      io.to(targetSocket).emit("incomingCall", { signal: signalData, from, name, callType });
    } else {
      try {
        const label = callType === "video" ? "📹 Missed Video Call" : "📞 Missed Audio Call";
        const missedMsg = await Message.create({
          chatType: "private",
          messageType: "call",
          senderId: from,
          receiverId: userToCall,
          senderName: name,
          photo: photo || "https://placeholder.com",
          text: `${label} (Offline)`,
          callDetails: { callType, duration: "Missed", status: "missed" },
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        });
        socket.emit("privateMessageSaved", missedMsg);
        socket.emit("callFailed", { message: "User is offline. Missed call saved in their history!" });
      } catch (err) {
        console.error("Save Offline Missed Call Error:", err);
      }
    }
  });

  socket.on("answerCall", ({ to, signal }) => {
    const targetSocket = onlineUsers[to];
    if (targetSocket) io.to(targetSocket).emit("callAccepted", signal);
  });

  socket.on("iceCandidate", ({ to, candidate }) => {
    const targetSocket = onlineUsers[to];
    if (targetSocket) io.to(targetSocket).emit("iceCandidate", { candidate });
  });

  socket.on("endCall", ({ to }) => {
    const targetSocket = onlineUsers[to];
    if (targetSocket) io.to(targetSocket).emit("callEnded");
  });

  socket.on("joinGroupCall", ({ roomID, user, callType }) => {
    if (!roomID || !user) return;
    const callRoom = `call_${roomID}`;
    socket.join(callRoom);
    socket.to(roomID).emit("groupCallStarted", { roomID, starterName: user.name, callType });
    socket.to(callRoom).emit("userJoinedGroupCall", { socketId: socket.id, user });
  });

  socket.on("groupCallSignal", ({ toSocketId, signal, fromUser }) => {
    io.to(toSocketId).emit("groupCallSignal", { fromSocketId: socket.id, signal, fromUser });
  });

  socket.on("groupCallIce", ({ toSocketId, candidate }) => {
    io.to(toSocketId).emit("groupCallIce", { fromSocketId: socket.id, candidate });
  });

  socket.on("leaveGroupCall", ({ roomID }) => {
    const callRoom = `call_${roomID}`;
    socket.leave(callRoom);
    socket.to(callRoom).emit("userLeftGroupCall", { socketId: socket.id });
  });

  socket.on("disconnect", () => {
    for (const uid in onlineUsers) {
      if (onlineUsers[uid] === socket.id) delete onlineUsers[uid];
    }
    io.emit("onlineUsersList", Object.keys(onlineUsers));

    for (const rId in roomUsers) {
      const beforeLen = roomUsers[rId].length;
      roomUsers[rId] = roomUsers[rId].filter((u) => u.socketId !== socket.id);
      if (roomUsers[rId].length !== beforeLen) {
        io.to(rId).emit("roomData", { room: rId, users: roomUsers[rId] });
      }
      if (roomUsers[rId].length === 0) delete roomUsers[rId];
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`NexusChat Server running on http://localhost:${PORT}`);
});
