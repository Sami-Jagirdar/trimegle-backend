// Starts the server that listens for new connection requests.
import { Server, Socket } from 'socket.io';
import express from "express";
import https from "https";
import 'dotenv/config';

const app = express();
const server = https.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_WHITELIST,
    methods: ["GET", "POST"],
  },
});

const activeUsers: Record<string, User> = {};

const rooms: Record<string, Room> = {};
// Find a room with < 3 members
function findAvailableRoom(): Room | null {
  for (const room of Object.values(rooms)) {
    if (room.available && room.members.length < 3) return room;
  }
  return null;
}

io.on("connection", (socket: Socket) => {
  console.log("New client: ", socket.id);

  // TODO Must create a schema for the socket.data and ensure it has name property
  const user = {
    id: socket.id,
    username: socket.data.name
  };

  // TODO for now key is socket.id, later it will be the username when users are authenticated
  activeUsers[socket.id] = user;

  // **User attempts to join a room
  socket.on("join", () => {
    let room = findAvailableRoom();
    if (!room) {
      room = {
        id: socket.id, // use first socketID as roomID
        members: [],
        available: true,
      }
      rooms[room.id] = room;
    }

    room.members.push(user);
    socket.join(room.id);

    // Since new user joined, the other users initiate a p2p connection with them
    io.to(room.id).emit("new-peer", {user: user});

    if (room.members.length >= 3) {
      room.available = false;
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