// migrations/run.js
// Roda um arquivo .sql de migration usando a mesma conexão configurada no .env.
//
// Uso:
//   node migrations/run.js migrations/2026-09-30_tesouraria_fase_a.sql

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dbConfig = require('../dbConfig');

async function main() {
    const arquivo = process.argv[2];
    if (!arquivo) {
        console.error('Uso: node migrations/run.js <caminho-do-arquivo.sql>');
        process.exit(1);
    }

    const caminhoCompleto = path.resolve(arquivo);
    const sql = fs.readFileSync(caminhoCompleto, 'utf8');

    // Separa em statements individuais (por ; no fim de linha), ignorando comentários -- e linhas em branco.
    const statements = sql
        .split('\n')
        .filter(linha => !linha.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

    console.log(`Conectando em ${dbConfig.host}/${dbConfig.database}...`);
    const connection = await mysql.createConnection(dbConfig);

    console.log(`Executando ${statements.length} comando(s) de ${arquivo}...`);
    for (const [i, statement] of statements.entries()) {
        const preview = statement.replace(/\s+/g, ' ').slice(0, 80);
        try {
            await connection.query(statement);
            console.log(`  [${i + 1}/${statements.length}] OK: ${preview}...`);
        } catch (err) {
            console.error(`  [${i + 1}/${statements.length}] ERRO: ${preview}...`);
            console.error(`    -> ${err.message}`);
        }
    }

    await connection.end();
    console.log('Concluído.');
}

main().catch(err => {
    console.error('Falha ao rodar a migration:', err.message);
    process.exit(1);
});
