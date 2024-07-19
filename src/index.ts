import dotenv from "dotenv";
import { Server } from "socket.io";
import * as https from "https";
import express, { Express, Request, Response } from "express";
import cors from "cors";
import { db } from "./firebase";
import {collection, addDoc, getDocs, query, where, limit} from 'firebase/firestore';

dotenv.config();
const app: Express = express();
app.use(cors());
const httpServer = https.createServer(app);

const port = process.env.PORT || 3000;

const io = new Server(httpServer, {
    cors: {
        origin: `http://localhost:${process.env.CORS_PORT}`, // replace 'http://localhost' with an env variable of acceptable client address later when you publish
        methods: ["GET", "POST"]
}});

io.on("connection", (socket) => {

    socket.on("join_room", async (ice_candidates) => {
        // TODO: broadcast the ice candidates to everyone in the room and emit
        const openRoomsQuery = query(collection(db,"Rooms"), where("open","==",true), limit(1));
        const openRoomSnapshot = await getDocs(openRoomsQuery);
        if (!openRoomSnapshot.empty) {
            const openRoom = openRoomSnapshot.docs[0];
            socket.join(openRoom.id);
            io.to(openRoom.id).emit("new_participant",ice_candidates);
            // socket.on("existing_ice_candidates", () => {

            // })
        }
        else {
            // TODO Add new room here
        }



        
        

    })

})




httpServer.listen(port, () => console.log(`Server is listening on http://localhost:${port}`));
