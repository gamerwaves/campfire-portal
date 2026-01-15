import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import crypto from "crypto";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";

// -------------------------------
// Docker-safe __dirname & static root
// -------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Serve static files from the directory where server.js lives
app.use(express.static(path.join(__dirname)));

// -------------------------------
// HTTP & Socket.IO setup
// -------------------------------
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0"; // bind to all interfaces in Docker

const httpServer = createServer(app);

const origins = [
  "https://astra-the-boop.github.io",
  "http://localhost",
  "http://localhost:3386",
  "http://dwait.local:3386",
  "https://2ae32e21bfbd.ngrok-free.app",
  "https://campfire-portal.vercel.app",
  "http://localhost:3001",
  "https://campfire-portal.fly.dev",
  "https://campfire-portal.onrender.com",
];

const io = new Server(httpServer, {
  cors: {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (origins.includes(origin)) return callback(null, true);
      console.warn(`Blocked socket.io origin ${origin}`);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST"],
  },
});

// -------------------------------
// Event & room management
// -------------------------------
const events = {};

function generateRoomName() {
  const timestamp = Date.now();
  const random = crypto.randomBytes(12).toString("hex");
  return `CampfirePortal${timestamp}${random}`;
}

function getRandom(eventId) {
  const candidates = Object.entries(events)
    .filter(([id, e]) => e.roomId && id !== eventId)
    .map(([id]) => id);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function hasSockets(eventId) {
  return Array.from(io.sockets.sockets.values()).some(
    (socket) => socket.data.eventId === eventId
  );
}

function leaveCall(socket) {
  if (!socket.data.inCall) return;
  const { roomId, eventId } = socket.data;

  if (roomId) socket.leave(roomId);

  const event = events[eventId];
  if (event) {
    const room = io.sockets.adapter.rooms.get(roomId);
    if (!room || room.size === 0) event.roomId = null;
  }

  socket.data.inCall = false;
  socket.data.roomId = null;
}

function serializeEvents() {
  return Object.entries(events).map(([id, e]) => {
    const participants = e.roomId
      ? io.sockets.adapter.rooms.get(e.roomId)?.size ?? 0
      : 0;
    return {
      id,
      inCall: Boolean(e.roomId),
      name: e.name,
      participants,
    };
  });
}

// -------------------------------
// Socket.IO events
// -------------------------------
io.on("connection", (socket) => {
  socket.on("enter", ({ eventId, eventName }) => {
    socket.data.eventId = eventId;
    socket.data.userName = eventName?.trim() || eventId;

    events[eventId] ??= {
      roomId: null,
      name: eventName?.trim() || eventId,
    };

    io.emit("events-update", serializeEvents());
  });

  socket.on("start-call", ({ eventId }) => {
    const event = events[eventId];
    if (!event) return;

    leaveCall(socket);

    const roomName = generateRoomName();
    event.roomId = roomName;
    event.hostSocketId = socket.id;

    socket.data.inCall = true;
    socket.data.roomId = event.roomId;

    const room = io.sockets.adapter.rooms.get(event.roomId);
    const existingUsers = room
      ? Array.from(room)
          .filter((id) => id !== socket.id)
          .map((id) => ({
            userId: id,
            userName: io.sockets.sockets.get(id)?.data?.userName || "Unknown",
          }))
      : [];

    socket.join(event.roomId);

    socket.to(event.roomId).emit("user-joined", {
      userId: socket.id,
      userName: socket.data.userName,
    });

    socket.emit("join-call", { roomId: event.roomId, existingUsers });
    io.emit("events-update", serializeEvents());
  });

  socket.on("join-existing", ({ eventId }) => {
    const event = events[eventId];
    if (!event?.roomId) return;

    leaveCall(socket);

    socket.data.inCall = true;
    socket.data.roomId = event.roomId;

    const room = io.sockets.adapter.rooms.get(event.roomId);
    const existingUsers = room
      ? Array.from(room)
          .filter((id) => id !== socket.id)
          .map((id) => ({
            userId: id,
            userName: io.sockets.sockets.get(id)?.data?.userName || "Unknown",
          }))
      : [];

    socket.join(event.roomId);

    socket.to(event.roomId).emit("user-joined", {
      userId: socket.id,
      userName: socket.data.userName,
    });

    socket.emit("join-call", { roomId: event.roomId, existingUsers });
    io.emit("events-update", serializeEvents());
  });

  socket.on("webrtc-offer", ({ offer, to }) => {
    socket.to(to).emit("webrtc-offer", {
      offer,
      from: socket.id,
      fromUserName: socket.data.userName,
    });
  });

  socket.on("webrtc-answer", ({ answer, to }) => {
    socket.to(to).emit("webrtc-answer", {
      answer,
      from: socket.id,
      fromUserName: socket.data.userName,
    });
  });

  socket.on("webrtc-ice-candidate", ({ candidate, to }) => {
    socket.to(to).emit("webrtc-ice-candidate", {
      candidate,
      from: socket.id,
    });
  });

  socket.on("disconnect", () => {
    const { eventId, roomId } = socket.data;
    if (!eventId) return;
    const event = events[eventId];

    if (roomId) socket.to(roomId).emit("user-left", { userId: socket.id });

    const isHost = event && event.hostSocketId === socket.id;
    const currentRoomId = roomId;

    leaveCall(socket);

    if (event) {
      if (isHost) {
        io.to(currentRoomId).emit("call-ended");
        event.roomId = null;
        event.hostSocketId = null;
      } else if (!hasSockets(eventId)) {
        delete events[eventId];
      }
    }

    io.emit("events-update", serializeEvents());
  });

  socket.on("leave-call", () => {
    const { roomId, eventId } = socket.data;
    const event = events[eventId];

    const isHost = event && event.hostSocketId === socket.id;
    const currentRoomId = roomId;

    if (roomId) socket.to(roomId).emit("user-left", { userId: socket.id });

    leaveCall(socket);

    if (event) {
      if (isHost) {
        io.to(currentRoomId).emit("call-ended");
        event.roomId = null;
        event.hostSocketId = null;
      } else if (!hasSockets(eventId)) {
        delete events[eventId];
      }
    }

    socket.emit("left-call");
    io.emit("events-update", serializeEvents());
  });

  socket.on("join-random", () => {
    const { eventId } = socket.data;
    const targetEventId = getRandom(eventId);
    if (!targetEventId) {
      socket.emit("no-random-calls");
      return;
    }

    const event = events[targetEventId];
    if (!event?.roomId) return;

    leaveCall(socket);

    socket.data.inCall = true;
    socket.data.roomId = event.roomId;

    const room = io.sockets.adapter.rooms.get(event.roomId);
    const existingUsers = room
      ? Array.from(room)
          .filter((id) => id !== socket.id)
          .map((id) => ({
            userId: id,
            userName: io.sockets.sockets.get(id)?.data?.userName || "Unknown",
          }))
      : [];

    socket.join(event.roomId);

    socket.to(event.roomId).emit("user-joined", {
      userId: socket.id,
      userName: socket.data.userName,
    });

    socket.emit("join-call", { roomId: event.roomId, existingUsers });
    io.emit("events-update", serializeEvents());
  });
});

// -------------------------------
// Start server
// -------------------------------
httpServer.listen(PORT, HOST, () => {
  console.log(`Server started on ${HOST}:${PORT}`);
});
