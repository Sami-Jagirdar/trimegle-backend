// Starts the server that listens for new connection requests.
import { Server, Socket } from 'socket.io';
import express from "express";
import http from "http"; // TODO: http in dev, https in prod
import 'dotenv/config';
import { nanoid } from 'nanoid';
import axios from 'axios';

const app = express();
const server = http.createServer(app);
const allowedOrigins = process.env.CORS_WHITELIST?.split(",") || [];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
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

const activeUsers: Record<string, User> = {};
const rooms: Record<string, Room> = {};

// TODO: Decide if user shouldn't be able to join the room they just left
// Find a room with < 3 members
function findAvailableRoom(): Room | null {
  const twoMemberRooms = Object.values(rooms).filter(room => room.available && room.members.length === 2);
  if (twoMemberRooms.length > 0) {
    return twoMemberRooms[Math.floor(Math.random() * twoMemberRooms.length)];
  }
  for (const room of Object.values(rooms)) {
    if (room.available && room.members.length < 3) return room;
  }
  return null;
}

io.on("connection", (socket: Socket) => {
  console.log("new client: ", socket.id);

  // TODO Must create a schema for the socket.data and ensure it has name property
  const user = {
    id: socket.id,
    username: socket.data.name
  };

  // TODO for now key is socket.id, later it will be the username when users are authenticated
  activeUsers[socket.id] = user;

  // **User attempts to join a room
  socket.on("join", (ack) => {
    let room = findAvailableRoom();
    if (!room) {
      room = {
        id: nanoid(10),
        members: [],
        available: true,
      }
      rooms[room.id] = room;
    }

    room.members.push(user);
    socket.join(room.id);

    // Let new participant know they joined the room so they can send offers on client side
    const otherMembers = room.members.filter(m => m.id !== socket.id).map(m => m.id);
    ack({ members: otherMembers, roomId: room.id });

    if (room.members.length >= 3) {
      room.available = false;
    }


  });

  // We will need to authenticate users later to ensure only room members can leave
  socket.on("leave", ({roomId, userId}) => {
    const room = rooms[roomId];
    if (room && room.members.some(member => member.id === userId)) {
      room.members = room.members.filter(member => member.id !== userId);
      socket.leave(roomId);
      if (room.members.length < 3) {
        room.available = true;
      }
    }
  });

  // **Have to create an event for users voting to kick

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
  })

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    io.emit("peer-disconnected", { socketId: socket.id });
  });

})

server.listen(process.env.PORT, () => {
  console.log("Server listening on ", process.env.PORT);
});
