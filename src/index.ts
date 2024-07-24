import dotenv from "dotenv";
import { Server } from "socket.io";
import * as https from "https";
import express, { Express, Request, Response } from "express";
import cors from "cors";
import { db } from "./firebase";
import {collection, addDoc, getDocs, query, where, limit, setDoc, doc, updateDoc, increment, getDoc} from 'firebase/firestore';

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

    socket.on("join_room", async () => {

        // Currently Rooms documents schema looks like {documentID: string, participants: string[], open: boolean}
        // Might see if denormalization is required with the participants field

        // TODO: Must encapsulate all of the below code involving firestore read and rights in a transaction to ensure concurrency is met
        const openRoomsQuery = query(collection(db,"Rooms"), where("open","==",true), limit(1));
        const openRoomSnapshot = await getDocs(openRoomsQuery);
        if (!openRoomSnapshot.empty) {
            const openRoom = openRoomSnapshot.docs[0];

            const openRoomRef = doc(db,"Rooms",openRoom.id);

            // Destructuring the data and not including the roomID because it's not necessary and destructuring understands this
            const openRoomData = (await getDoc(openRoomRef)).data() as {participants: string[], open: boolean}; 
            openRoomData.participants.push(socket.id);
            updateDoc(openRoomRef, {
                participants: openRoomData.participants
            })
            
            if (openRoomData.participants.length>=3) {
                updateDoc(openRoomRef, {
                    open: false
                })
            }

            socket.join(openRoom.id);

            // This socket id allows other users to send their offer/answers
            socket.to(openRoom.id).emit("new peer", socket.id) 

            // This emit is for the client themselves to let them know a room was successfully joined
            socket.emit('room joined', openRoom.id);
        }
        else {
            const newRoomRef = await addDoc(collection(db, "Rooms"), {
                participants: [socket.id],
                open: true
            });
            console.log("Added new room with ID: ",newRoomRef.id)

            socket.join(newRoomRef.id);
            socket.emit('room joined', newRoomRef.id);
        }

    })

})




httpServer.listen(port, () => console.log(`Server is listening on http://localhost:${port}`));
