import express from 'express';
import axios from 'axios';
import { db } from '../sql/db.js';
import { generateToken } from '../util/auth.js';
import 'dotenv/config';

const router = express.Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_AUTH_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_AUTH_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const FRONTEND_URL = process.env.FRONTEND_URL;

router.get('/google', (_, res) => {
    const scopes = ['openid', 'profile', 'email'].join(' ');
    const googleAuthUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' +
        `client_id=${GOOGLE_CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}&` +
        `response_type=code&` +
        `scope=${encodeURIComponent(scopes)}&` +
        'access_type=offline&' +
        'prompt=consent';
    res.redirect(googleAuthUrl);
});

router.get('/google/callback', async (req, res) => {
    const {code} = req.query;

    if (!code) {
        return res.redirect(`${FRONTEND_URL}/auth/error?message=No authorization code received`);
    }

    try {
        const tokenResponse =  await axios.post('https://oauth2.googleapis.com/token', {
            code,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            redirect_uri: GOOGLE_REDIRECT_URI,
            grant_type: 'authorization_code'
        });
        const { access_token } = tokenResponse.data;

        const userInfoResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${access_token}`}
        });

        const googleUser = userInfoResponse.data;

        const user = await db.findOrCreateUser({
            id: googleUser.id,
            email: googleUser.email,
            name: googleUser.name,
            picture: googleUser.picture
        });

        if (user.is_banned) {
            return res.redirect(`${FRONTEND_URL}/auth/error?message=Your account is banned`);
        }

        const token = generateToken({
            userId: user.id,
            email: user.email,
            name: user.username,
            avatarUrl: user.avatar_url || undefined
        }); 

        res.redirect(`${FRONTEND_URL}/auth/success?token=${token}`);
    } catch (error) {
        console.error('Error during Google OAuth callback:', error);
        res.redirect(`${FRONTEND_URL}/auth/error?message=Authentication failed`);
    }
});

export default router;