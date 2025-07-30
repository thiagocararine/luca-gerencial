// corrigir_permissoes.js

const mysql = require('mysql2/promise');
const dbConfig = require('./dbConfig'); // Garanta que o caminho para seu dbConfig está correto

async function corrigirPermissoes() {
    let connection;
    // O ID do perfil de administrador que queremos corrigir.
    const adminProfileId = 1; 

    console.log('Iniciando script de correção de permissões...');

    try {
        console.log('Conectando ao banco de dados...');
        connection = await mysql.createConnection(dbConfig);
        console.log('Conexão bem-sucedida.');

        console.log(`Limpando permissões antigas para o perfil ID: ${adminProfileId}...`);
        const [deleteResult] = await connection.execute(
            'DELETE FROM perfil_permissoes WHERE id_perfil = ?', 
            [adminProfileId]
        );
        console.log(`${deleteResult.affectedRows} permissões antigas removidas.`);

        const permissoesParaInserir = [
            'Lançamentos',
            'Logística',
            'Configurações'
        ];

        console.log('Inserindo permissões corretas com codificação UTF-8...');
        for (const nomeModulo of permissoesParaInserir) {
            await connection.execute(
                'INSERT INTO perfil_permissoes (id_perfil, nome_modulo, permitido) VALUES (?, ?, ?)',
                [adminProfileId, nomeModulo, 1]
            );
            console.log(` -> Permissão para "${nomeModulo}" inserida com sucesso.`);
        }

        console.log('\nCORREÇÃO APLICADA COM SUCESSO!');
        console.log('As permissões para o administrador foram recriadas com a codificação correta.');

    } catch (error) {
        console.error('\n!!! OCORREU UM ERRO DURANTE A EXECUÇÃO DO SCRIPT !!!');
        console.error(error);
    } finally {
        if (connection) {
            await connection.end();
            console.log('Conexão com o banco de dados fechada.');
        }
    }
}

corrigirPermissoes();