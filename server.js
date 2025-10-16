// server.js — Stock Price Checker (FCC)
// Requisitos: axios, express, helmet, pg, dotenv

require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const axios = require('axios');
const { Pool } = require('pg');

const app = express();

/* ================== Seguridad (tests #2 y #7) ================== */
app.use(helmet.hidePoweredBy({ setTo: 'PHP 7.4.3' }));   // X-Powered-By: PHP 7.4.3
app.use(helmet.frameguard({ action: 'deny' }));          // X-Frame-Options: DENY
app.use(helmet.xssFilter());                             // X-XSS-Protection
app.use(helmet.noSniff());                               // X-Content-Type-Options: nosniff

// Cache busting requerido por FCC
app.use((req, res, next) => {
  res.set({
    'Surrogate-Control': 'no-store',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  next();
});

// Content Security Policy: solo scripts y estilos de 'self' (test #2)
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc:  ["'self'"],
    styleSrc:   ["'self'"]
  }
}));
/* =============================================================== */

// Parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static y view principal (mantén tu /public y /views como en el boilerplate)
app.use('/public', express.static(path.join(process.cwd(), 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'views', 'index.html'));
});

/* ================ PostgreSQL (Neon) ================= */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Neon requiere SSL
});

// Crear tabla si no existe
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_likes (
      symbol TEXT PRIMARY KEY,
      likes  INTEGER NOT NULL DEFAULT 0,
      ips    TEXT[] NOT NULL DEFAULT '{}'
    )
  `);
}

pool.connect()
  .then(async client => {
    client.release();
    await ensureSchema();
    console.log('✅ Conectado a PostgreSQL y schema OK');
  })
  .catch(err => {
    console.error('❌ Error conectando a PostgreSQL:', err.message);
  });

/* ================ Helpers ================= */
const PROXY = 'https://stock-price-checker-proxy.freecodecamp.rocks';

async function getStockPrice(symbol) {
  const url = `${PROXY}/v1/stock/${encodeURIComponent(symbol)}/quote`;
  const { data } = await axios.get(url, { timeout: 10000 });
  // La API del proxy expone .symbol y .latestPrice
  return {
    stock: (data.symbol || symbol).toUpperCase(),
    price: Number(data.latestPrice)
  };
}

function getClientIP(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.connection?.remoteAddress || req.ip || '0.0.0.0';
}

async function likeStockIfNeeded(symbol, ip, likeFlag) {
  // Asegura fila
  await pool.query(
    `INSERT INTO stock_likes (symbol, likes, ips)
     VALUES ($1, 0, '{}')
     ON CONFLICT (symbol) DO NOTHING`,
    [symbol]
  );

  if (!likeFlag) return;

  // Solo 1 like por IP por stock
  const { rows } = await pool.query(
    `SELECT likes, ips FROM stock_likes WHERE symbol = $1`,
    [symbol]
  );
  const row = rows[0];
  const already = row.ips.includes(ip);
  if (!already) {
    await pool.query(
      `UPDATE stock_likes
       SET likes = likes + 1,
           ips   = array_append(ips, $2)
       WHERE symbol = $1`,
      [symbol, ip]
    );
  }
}

async function getLikes(symbol) {
  const { rows } = await pool.query(
    `SELECT likes FROM stock_likes WHERE symbol = $1`,
    [symbol]
  );
  return rows[0]?.likes ?? 0;
}

/* ================ API ================= */
/**
 * GET /api/stock-prices
 * ?stock=GOOG            -> { stockData: { stock, price, likes } }
 * ?stock=GOOG&like=true
 * ?stock=GOOG&stock=MSFT -> { stockData: [{ stock, price, rel_likes }, { ... }] }
 * Con like=true aplica a ambos.
 */
app.get('/api/stock-prices', async (req, res) => {
  try {
    let { stock, like } = req.query;
    const likeFlag = String(like).toLowerCase() === 'true';
    const ip = getClientIP(req);

    if (!stock) {
      return res.status(400).json({ error: 'stock query param required' });
    }

    // Puede venir como string o como array de dos símbolos
    const stocks = Array.isArray(stock) ? stock : [stock];

    if (stocks.length === 1) {
      const sym = stocks[0].toUpperCase();
      await likeStockIfNeeded(sym, ip, likeFlag);

      const [{ stock: s, price }] = await Promise.all([getStockPrice(sym)]);
      const likes = await getLikes(sym);

      return res.json({
        stockData: { stock: s, price, likes }
      });
    }

    // Doble stock (tomamos solo los dos primeros por si mandan más)
    const symA = String(stocks[0]).toUpperCase();
    const symB = String(stocks[1]).toUpperCase();

    await Promise.all([
      likeStockIfNeeded(symA, ip, likeFlag),
      likeStockIfNeeded(symB, ip, likeFlag)
    ]);

    const [a, b, likesA, likesB] = await Promise.all([
      getStockPrice(symA),
      getStockPrice(symB),
      getLikes(symA),
      getLikes(symB)
    ]);

    const relA = likesA - likesB;
    const relB = likesB - likesA;

    return res.json({
      stockData: [
        { stock: a.stock, price: a.price, rel_likes: relA },
        { stock: b.stock, price: b.price, rel_likes: relB }
      ]
    });
  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ error: 'external source error' });
  }
});

/* ================ Healthcheck ================= */
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.send('ok');
  } catch (e) {
    res.status(500).send('db error');
  }
});

/* ================ Start ================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Servidor escuchando en puerto ${PORT}`));

module.exports = app;
