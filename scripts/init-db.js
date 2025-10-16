// scripts/init-db.js
const { Client } = require('pg');

(async () => {
  try {
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Neon usa SSL
    });
    await client.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_likes (
        symbol TEXT PRIMARY KEY,
        likes  INTEGER NOT NULL DEFAULT 0,
        ips    TEXT[] NOT NULL DEFAULT '{}'
      );
    `);
    console.log('✅ Tabla creada/lista');
    await client.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error creando tabla:', err.message);
    process.exit(1);
  }
})();
