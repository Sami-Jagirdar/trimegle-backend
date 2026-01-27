import { createClient } from "redis";
import 'dotenv/config';

const redisClient = createClient({
    url: process.env.REDIS_URL,
    socket: {
        reconnectStrategy: (retries) => {
            if (retries > 10) {
                console.error("Unable to connect to Redis after 10 attempts.");
                return new Error("Max retries reached");
            }
            return Math.min(retries * 100, 3000); // Amount of time to wait before reconnecting
        }
    }
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));
redisClient.on('connect', () => console.log("Redis Client Connected"));
redisClient.on('ready', () => console.log("Redis Client Ready"));

// Connect to Redis server
// IIFE to handle async/await at the top level
(async (): Promise<void> => {
    try {
        await redisClient.connect();
    } catch (error) {
        console.error("Failed to connect to Redis:", error);
    }
})();

export interface ActiveUser {
    userId: number;
    socketId: string;
    username: string;
    avatarUrl: string;
    roomId: string | null;
    connectedAt: number;
    lastJoinedRoomId: string | null;
}

export interface Room {
    id: string;
    members: ActiveUser[];
    available: boolean;
    createdAt: number;
}

// Redis helper functions to be used throughout the app for managing active users and rooms
export const redis = {

    // User Presence Tracking
    async setUserOnline(userId: number, socketId: string, username: string, avatarUrl: string | null): Promise<void> {
        const user: ActiveUser = {
            userId,
            socketId,
            username,
            avatarUrl,
            roomId: null,
            connectedAt: Date.now(),
            lastJoinedRoomId: null,
        };
        await redisClient.set(`user:${userId}`, JSON.stringify(user), {EX: 60 * 60 * 24}); // 24 hours expiry
        await redisClient.set(`socket:${socketId}`, userId.toString(), {EX: 60 * 60 * 24});
        // Using redis sets to track all active users (sAdd is set add)
        await redisClient.sAdd('activeUsers', userId.toString())
    },

    async getUser(userId: number): Promise<ActiveUser | null>  {
        const data = await redisClient.get(`user:${userId}`);
        return data ? JSON.parse(data.toString()) as ActiveUser : null;
    },

    async getUserBySocketId(socketId: string): Promise<ActiveUser | null> {
        const userId = await redisClient.get(`socket:${socketId}`);
        return userId ? this.getUser(parseInt(userId.toString())) : null;
    },

    async setUserOffline(userId: number, socketId: string): Promise<void> {
        await redisClient.del(`user:${userId}`);
        await redisClient.del(`socket:${socketId}`);
        await redisClient.sRem('activeUsers', userId.toString());
    },

    async getActiveUserCount(): Promise<number> {
        const count = await redisClient.sCard('activeUsers');
        return Number(count);
    },

    // Room Management
    async createRoom(roomId: string): Promise<void> {
        const room: Room = {
            id: roomId,
            members: [],
            available: true,
            createdAt: Date.now(),
        };
        await redisClient.set(`room:${roomId}`, JSON.stringify(room));
    },

    async updateRoom(room: Room): Promise<void> {
        await redisClient.set(`room:${room.id}`, JSON.stringify(room));
    },

    async getRoom(roomId: string): Promise<Room | null> {
        const data = await redisClient.get(`room:${roomId}`);
        return data ? JSON.parse(data.toString()) as Room : null;
    },

    async getAllRooms(): Promise<Room[]> {
        const keys = await redisClient.keys('room:*');
        const rooms: Room[] = [];
        for (const key of keys) {
            const data = await redisClient.get(key);
            if (data) rooms.push(JSON.parse(data.toString()) as Room);
        }
        return rooms;
    },

    async deleteRoom(roomId: string): Promise<void> {
        await redisClient.del(`room:${roomId}`);
    },

    // Assumes the room is available
    async addUserToRoom(roomId: string, user: ActiveUser): Promise<void> {
        const room = await this.getRoom(roomId);
        if (!room) return;
        if (room.members.length >= 3) return;
        room.members.push(user);
        if (room.members.length >= 3) {
            room.available = false;
        }
        await this.updateRoom(room);

        const addedUser = await this.getUser(user.userId);
        if (addedUser) {
            addedUser.roomId = roomId;
            await redisClient.set(`user:${user.userId}`, JSON.stringify(addedUser), {EX: 60 * 60 * 24});
        }
    },

    async removeUserFromRoom(roomId: string, userId: number): Promise<void> {
        const room = await this.getRoom(roomId);
        if (!room) return;
        room.members = room.members.filter(member => member.userId !== userId);
        if (room.members.length === 0) {
            await this.deleteRoom(roomId);
        } else {
            if (room.members.length < 3) {
                room.available = true;
            }
            await this.updateRoom(room);
        }

        const addedUser = await this.getUser(userId);
        if (addedUser) {
            addedUser.roomId = null;
            addedUser.lastJoinedRoomId = roomId;
            await redisClient.set(`user:${userId}`, JSON.stringify(addedUser), {EX: 60 * 60 * 24});
        }
    },

    async checkRateLimit(key: string, limit: number, durationSeconds: number): Promise<boolean> {
        const current = await redisClient.incr(key);
        if (current === 1) {
            await redisClient.expire(key, durationSeconds);
        }
        return Number(current) <= limit;
    }
};

export default redisClient;