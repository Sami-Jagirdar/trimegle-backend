import dotenv from "dotenv";
import { Server } from "socket.io";
import * as https from "https";
import express, { Express, Request, Response } from "express";
import cors from "cors";
import { db } from "./firebase";

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

    socket.on("join_room", (ice_candidates) => {
        // TODO: broadcast the ice candidates to everyone in the room and emit
        
    })

})




httpServer.listen(port, () => console.log(`Server is listening on http://localhost:${port}`));
