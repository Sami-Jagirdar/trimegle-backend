import { Server, Socket } from 'socket.io';
import express from "express";
import http from "http"; // TODO: http in dev, https in prod
import 'dotenv/config';
import { nanoid } from 'nanoid';
import axios from 'axios';
import cors from 'cors';
import { db } from './sql/db.js';
import { verifyToken, JWTPayload } from './util/auth.js';
import authRoutes from './routes/auth.js';
import { ActiveUser, redis } from './util/redis.js';

const app = express();
const server = http.createServer(app);
const allowedOrigins = process.env.CORS_WHITELIST?.split(",") || [];

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST"],
  credentials: false // only for now, since no auth cookies are used
}));

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  },
});

app.set("trust proxy", 1);

app.use('/auth', authRoutes);

app.get('/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/ice-config', async (_, res) => {
  try {
    const response = await axios.post(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${process.env.CLOUDFARE_TURN_TOKEN_ID}/credentials/generate-ice-servers`,
      { ttl: 86400 },
      {
        headers: {
          'Authorization': `Bearer ${process.env.CLOUDFARE_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const cloudflareServers = response.data.iceServers;
    console.log('Generated Cloudflare TURN credentials:', response.data);

    res.json({
      iceServers: [
        // Public STUN servers (free, always available)
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        
        // Cloudflare TURN servers (temporary credentials)
        {
          urls: cloudflareServers[1].urls,
          username: cloudflareServers[1].username,
          credential: cloudflareServers[1].credential
        }
      ]
    });

  } catch (error) {
    console.error('Error generating Cloudflare TURN credentials:', {
      message: error.message,
      response: error.response?.data
    });
    
    // Return public STUN as fallback
    res.status(500).json({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });
  }
});

interface AuthenticatedSocket extends Socket {
  user?: JWTPayload;
}

// use is a middleware (like a function) that runs for every incoming socket connection
io.use(async (socket: AuthenticatedSocket, next) => {
  try {
    // socket comes from client with token in handshake auth
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error("Authentication error: No token provided"));
    }
    const decoded = verifyToken(token);
    const user = await db.getUserbyId(decoded.userId);
    if (!user) {
      return next(new Error("Authentication error: User not found"));
    }
    if (user.is_banned) {
      return next(new Error("Authentication error: User is banned"));
    }
    socket.user = decoded;
    next();

  } catch {
    next(new Error("Authentication error"));
  }
})



io.on("connection", async (socket: AuthenticatedSocket) => {
  const user = socket.user!;
  console.log(`User connected: ${user.name} (ID: ${user.userId}, Socket: ${socket.id})`);

  // TODO Must create a schema for the socket.data and ensure it has name property
  // const user = {
  //   id: socket.id,
  //   username: socket.data.name
  // };

  try {
    await redis.setUserOnline(user.userId, socket.id, user.name, user.avatarUrl);

    socket.on('join', async (ack) => {
      try {
        const isBanned = await db.isUserBanned(user.userId);
        if (isBanned) {
          ack({error: "Account Banned"});
          socket.disconnect();
          return;
        }

        let room = await redis.findAvailableRoom();
        if (!room) {
          const roomId = nanoid(10);
          await redis.createRoom(roomId);
          room = await redis.getRoom(roomId);
        }
        
        if (!room) {
          ack({error: "Failed to create or find room"});
          return;
        }

        const activeUser: ActiveUser = {
          userId: user.userId,
          socketId: socket.id,
          username: user.name,
          avatarUrl: user.avatarUrl,
          roomId: room.id,
          connectedAt: Date.now(),
          lastJoinedRoomId: null
        };

        await redis.addUserToRoom(room.id, activeUser);
        socket.join(room.id);
        const updatedRoom = await redis.getRoom(room.id);
        const otherMembers = room.members
          .filter(m => m.userId !== user.userId)
          .map(m => m.socketId);
        ack({ members: otherMembers, roomId: room.id });
        console.log(`User ${user.name} joined room ${room.id}. Room size: ${updatedRoom!.members.length}`);

      } catch (error) {
        console.error('Error in join handler:', error);
      }



    });


    socket.on('leave', async ({roomId}) => {
      try {
        const room = await redis.getRoom(roomId);

        if (room && room.members.some(member => member.userId === user.userId)) {
          await redis.removeUserFromRoom(roomId, user.userId);
          socket.leave(roomId);
          // Notify remaining members
          socket.to(roomId).emit("peer-disconnected", { socketId: socket.id });
          console.log(`User ${user.name} left room ${roomId}`);
        }
      } catch (error) {
        console.error('Error in leave handler:', error);
      }
    });

    // **Offer
    socket.on("offer", ({to, sdp}) => {
      io.to(to).emit("offer", {from: socket.id, sdp});
    });

    // **Answer
    socket.on("answer", ({to, sdp}) => {
      io.to(to).emit("answer", {from: socket.id, sdp});
    });

    // **ICE Candidates
    socket.on("ice-candidate", ({to, candidate}) => {
      io.to(to).emit("ice-candidate", {from: socket.id, candidate})
    });

    socket.on("disconnect", async () => {
      console.log(`User disconnected: ${user.name} (Socket: ${socket.id})`);

      try {
        const activeUser = await redis.getUser(user.userId);
        if (activeUser?.roomId) {
          const room = await redis.getRoom(activeUser.roomId);
          if (room) {
            // Notify other members in the room
            await redis.removeUserFromRoom(room.id, user.userId);
            socket.to(room.id).emit("peer-disconnected", { socketId: socket.id });
            console.log(`Notified room ${room.id} of ${user.name}'s disconnection.`);
          }
        }
        await redis.setUserOffline(user.userId, socket.id);

      } catch (error) {
        console.error('Error handling disconnect room cleanup:', error);
      }
    });

  } catch (error) {
    console.error('Error in connection handler:', error);
    socket.disconnect();
  }


})

server.listen(process.env.PORT, () => {
  console.log("Server listening on ", process.env.PORT);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
