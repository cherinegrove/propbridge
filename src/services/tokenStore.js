// src/services/tokenStore.js
// Persistent token store using PostgreSQL (falls back to memory if no DB)
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    // Create tables if they don't exist
    pool.query(`
      CREATE TABLE IF NOT EXISTS tokens (
        portal_id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sync_rules (
        portal_id TEXT PRIMARY KEY,
        rules JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `).then(() => console.log('[DB] Tables ready'))
      .catch(err => console.error('[DB] Table creation error:', err.message));
  }
  return pool;
}

// In-memory fallback
const memStore = {};

module.exports = {
  async get(portalId) {
    const p = getPool();
    if (p) {
      try {
        const result = await p.query('SELECT data FROM tokens WHERE portal_id = $1', [String(portalId)]);
        return result.rows[0]?.data || null;
      } catch (err) {
        console.error('[DB] Get token error:', err.message);
      }
    }
    return memStore[portalId] || null;
  },

  async set(portalId, tokens) {
    const data = { ...tokens, savedAt: Date.now() };
    const p = getPool();
    if (p) {
      try {
        await p.query(`
          INSERT INTO tokens (portal_id, data, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (portal_id) DO UPDATE SET data = $2, updated_at = NOW()
        `, [String(portalId), JSON.stringify(data)]);
        return;
      } catch (err) {
        console.error('[DB] Set token error:', err.message);
      }
    }
    memStore[portalId] = data;
  },

  async delete(portalId) {
    const p = getPool();
    if (p) {
      try {
        await p.query('DELETE FROM tokens WHERE portal_id = $1', [String(portalId)]);
        return;
      } catch (err) {
        console.error('[DB] Delete token error:', err.message);
      }
    }
    delete memStore[portalId];
  },

  async getAll() {
    const p = getPool();
    if (p) {
      try {
        const result = await p.query('SELECT portal_id, data FROM tokens');
        const all = {};
        result.rows.forEach(row => { all[row.portal_id] = row.data; });
        return all;
      } catch (err) {
        console.error('[DB] GetAll error:', err.message);
      }
    }
    return { ...memStore };
  }
};
