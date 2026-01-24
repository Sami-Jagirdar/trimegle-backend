import { Pool } from "pg";

// Could use individual fields instead of connectionString if needed
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    connectionTimeoutMillis: 2000,
})

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Test connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Error connecting to the database:', err);
  } else {
    console.log('Database connected successfully at:', res.rows[0].now);
  }
});

export interface User {
  id: number;
  google_id: string;
  username: string;
  email: string;
  created_at: Date;
  updated_at: Date;
  is_banned: boolean;
}

export const db = {

  async findOrCreateUser(googleProfile: { id: string; email: string; name: string; picture?: string; }): Promise<User> {
    const client = await pool.connect();
    try {
      const result = await client.query<User>("SELECT * FROM users WHERE google_id = $1", [googleProfile.id]);
      if (result.rows.length > 0) {
        return result.rows[0];
      }
      const insertResult = await client.query<User>(
        "INSERT INTO users (google_id, username, email, avatar_url) VALUES ($1, $2, $3, $4) RETURNING *",
        [googleProfile.id, googleProfile.name, googleProfile.email, googleProfile.picture || null]
      );
      return insertResult.rows[0];
    }
    finally {
      client.release();
    }
  },

  async getUserbyId(id: number): Promise<User | null> {
    const result = await pool.query<User>("SELECT * FROM users WHERE id = $1", [id]);
    return result.rows.length > 0 ? result.rows[0] : null;
  },

  async getUserbyGoogleId(googleId: string): Promise<User | null> {
    const result = await pool.query<User>("SELECT * FROM users WHERE google_id = $1", [googleId]);
    return result.rows.length > 0 ? result.rows[0] : null;
  },

  async isUserBanned(id: number): Promise<boolean> {
    const result = await pool.query<{ is_banned: boolean }>("SELECT is_banned FROM users WHERE id = $1", [id]);
    return result.rows.length > 0 ? result.rows[0].is_banned : false;
  },

  async banUser(userId: number, bannedBy: number, reason: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Update user banned status
      await client.query('UPDATE users SET is_banned = TRUE WHERE id = $1', [userId]);
      
      // Add to ban history
      await client.query(
        'INSERT INTO ban_history (user_id, banned_by, reason) VALUES ($1, $2, $3)',
        [userId, bannedBy, reason]
      );
      
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },
}

export default pool;