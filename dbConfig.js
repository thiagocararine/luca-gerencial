// dbConfig.js

// Carrega as variáveis de ambiente do arquivo .env
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
};

module.exports = dbConfig;
