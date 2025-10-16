'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Trust proxy para IPs en Replit/Heroku/Render
app.set('trust proxy', true);

// Middlewares
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Rutas de la API
require('./routes/api.js')(app);

// Inicio de servidor
const PORT = 5000;
app.listen(PORT, function () {
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});

module.exports = app; // exportar para pruebas
