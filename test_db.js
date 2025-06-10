// test_db.js

// Este script serve apenas para testar a ligação à base de dados.
// Ele usa as mesmas configurações que a sua aplicação principal.

const mysql = require('mysql2/promise');
require('dotenv').config(); // Carrega as variáveis do arquivo .env

// Configuração da Base de Dados (lendo do .env)
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    connectTimeout: 10000 // Adiciona um timeout de 10 segundos
};

async function testConnection() {
    console.log("A iniciar o teste de ligação à base de dados...");
    console.log("Configurações a serem usadas:", {
        host: dbConfig.host,
        user: dbConfig.user,
        database: dbConfig.database,
        password: dbConfig.password ? '******' : 'Nenhuma' // Não mostra a senha no log
    });

    let connection;
    try {
        console.log("\nA tentar criar a ligação...");
        connection = await mysql.createConnection(dbConfig);
        console.log("✅ Sucesso! A ligação à base de dados foi estabelecida.");

        console.log("\nA executar uma query de teste (SELECT NOW())...");
        const [rows] = await connection.execute('SELECT NOW() as currentTime');
        console.log("✅ Query executada com sucesso!");
        console.log("   Data e hora do servidor da base de dados:", rows[0].currentTime);
        
    } catch (error) {
        console.error("\n❌ FALHA NA LIGAÇÃO À BASE DE DADOS!");
        console.error("--------------------------------------------------");
        console.error("ERRO DETALHADO:", error);
        console.error("--------------------------------------------------");
        console.error("\nPossíveis Causas:");
        console.error("1. Verifique se o arquivo '.env' existe na raiz do seu projeto.");
        console.error("2. Verifique se os dados (DB_HOST, DB_USER, DB_PASSWORD, DB_DATABASE) no arquivo '.env' estão 100% corretos.");
        console.error("3. Verifique se há conectividade de rede (firewall, VPN) entre o seu computador e o servidor da base de dados.");

    } finally {
        if (connection) {
            await connection.end();
            console.log("\nLigação à base de dados fechada.");
        }
        process.exit();
    }
}

testConnection();
