import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

const JWT_SECRET = process.env.JWT_SECRET
const JWT_EXPIRES_IN = '7d';

// Can modify this based on other user metadata to store in the token
export interface JWTPayload {
    userId: number;
    email: string;
    name: string;
    avatarUrl?: string;
}

export function generateToken(payload: JWTPayload): string {
    return jwt.sign(payload, JWT_SECRET as string, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JWTPayload {
    try {
        return jwt.verify(token, JWT_SECRET as string) as JWTPayload;
    } catch (error) {
        throw new Error('Invalid or expired token', { cause: error });
    }
}

// Essentially, any request must have a valid JWT token to proceed
export function authenticateRequest(req: Request, res: Response, next: NextFunction): Response | void {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({error: 'No token provided'});
        }

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix
        const decoded = verifyToken(token);
        req.user = decoded; 
        next();
    } catch {
        return res.status(401).json({error: 'Invalid or expired token'});
    }
}


