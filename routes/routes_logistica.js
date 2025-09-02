const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const { authenticateToken, authorizeAdmin } = require('../middlewares'); 
const dbConfig = require('../dbConfig');

// --- CONFIGURAÇÃO DO MULTER E HELPERS ---

const UPLOADS_BASE_PATH = process.env.UPLOADS_BASE_PATH || path.join(__dirname, '..', 'uploads');
const sanitizeForPath = (str) => String(str || '').replace(/[^a-zA-Z0-9-]/g, '_');

const vehicleStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const vehicleId = req.params.id;
        let connection;
        try {
            connection = await mysql.createConnection(dbConfig);
            const [rows] = await connection.execute('SELECT placa FROM veiculos WHERE id = ?', [vehicleId]);
            if (rows.length === 0) {
                return cb(new Error(`Veículo com ID ${vehicleId} não encontrado.`));
            }
            const placaSanitizada = sanitizeForPath(rows[0].placa);
            
            const isPhoto = file.mimetype.startsWith('image/');
            const subfolder = isPhoto ? 'fotos' : 'documentos';
            const destPath = path.join(UPLOADS_BASE_PATH, 'veiculos', placaSanitizada, subfolder);

            await fs.mkdir(destPath, { recursive: true });
            cb(null, destPath);
        } catch (err) {
            console.error("Erro no destino do Multer:", err);
            cb(err);
        } finally {
            if (connection) await connection.end();
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        cb(null, `temp-${uniqueSuffix}${extension}`);
    }
});

const vehicleUpload = multer({ 
    storage: vehicleStorage,
    limits: { fileSize: 3 * 1024 * 1024 } // 3MB
}).single('ficheiro');

const checklistStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Salva tudo em uma pasta temporária primeiro
        const tempPath = path.join(UPLOADS_BASE_PATH, 'temp_checklists');
        cb(null, tempPath);
    },
    filename: (req, file, cb) => {
        // Mantém a criação de um nome de arquivo único
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        cb(null, `${file.fieldname}-${uniqueSuffix}${extension}`);
    }
});

const checklistUpload = multer({ storage: checklistStorage }).any();

/**
 * Função Auxiliar para registrar logs de logística.
 */
async function registrarLog(logData) {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            INSERT INTO logistica_logs 
            (usuario_id, usuario_nome, tipo_entidade, id_entidade, tipo_acao, descricao) 
            VALUES (?, ?, ?, ?, ?, ?)`;
        await connection.execute(sql, [
            logData.usuario_id,
            logData.usuario_nome,
            logData.tipo_entidade,
            logData.id_entidade || null,
            logData.tipo_acao,
            logData.descricao
        ]);
    } catch (error) {
        console.error("ERRO AO REGISTRAR LOG DE LOGÍSTICA:", error);
    } finally {
        if (connection) await connection.end();
    }
}

// --- ROTAS DE VEÍCULOS ---

router.get('/veiculos', authenticateToken, async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            SELECT 
                v.*, 
                p.NOME_PARAMETRO as nome_filial,
                (SELECT vf.caminho_foto FROM veiculo_fotos vf WHERE vf.id_veiculo = v.id AND vf.descricao = 'Frente' LIMIT 1) as foto_frente
            FROM 
                veiculos v
            LEFT JOIN 
                parametro p ON v.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
            ORDER BY 
                v.modelo ASC`;

        const [vehicles] = await connection.execute(sql);
        
        // ATUALIZADO: Mapeia os resultados para construir a URL completa da foto
        const vehiclesWithPhotoUrl = vehicles.map(vehicle => {
              const placaSanitizada = sanitizeForPath(vehicle.placa);
              const fotoFrentePath = vehicle.foto_frente
                ? `uploads/veiculos/${placaSanitizada}/fotos/${vehicle.foto_frente}`
                : null;

              return {
                  ...vehicle,
                  foto_frente: fotoFrentePath
              };
        });

        res.json(vehiclesWithPhotoUrl);

    } catch (error) {
        console.error("Erro ao buscar veículos:", error);
        res.status(500).json({ error: 'Erro ao buscar a lista de veículos.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.post('/veiculos', authenticateToken, async (req, res) => {
    const { userId, nome: nomeUsuario, perfil } = req.user;
    const allowedProfiles = ["Administrador", "Financeiro", "Logistica"];
    if (!allowedProfiles.includes(perfil)) {
        return res.status(403).json({ error: 'Você não tem permissão para executar esta ação.' });
    }
    
    const { placa, marca, modelo, ano_fabricacao, ano_modelo, renavam, chassi, id_filial, status, seguro, rastreador, tipo_combustivel } = req.body;
    if (!placa || !marca || !modelo || !id_filial || !status) {
        return res.status(400).json({ error: 'Placa, marca, modelo, filial e status são obrigatórios.' });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const sql = `
            INSERT INTO veiculos 
            (placa, marca, modelo, ano_fabricacao, ano_modelo, renavam, chassi, id_filial, status, seguro, rastreador, tipo_combustivel) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            
        const params = [
            placa, marca, modelo, 
            ano_fabricacao || null, ano_modelo || null, 
            renavam || null, chassi || null, id_filial, status, 
            seguro ? 1 : 0, rastreador ? 1 : 0, 
            tipo_combustivel || null
        ];
        const [result] = await connection.execute(sql, params);
        const newVehicleId = result.insertId;

        await registrarLog({
            usuario_id: userId, usuario_nome: nomeUsuario, tipo_entidade: 'Veículo',
            id_entidade: newVehicleId, tipo_acao: 'Criação',
            descricao: `Criou o veículo ${modelo} - ${placa} (ID: ${newVehicleId}).`
        });

        await connection.commit();
        res.status(201).json({ message: 'Veículo adicionado com sucesso!', vehicleId: newVehicleId });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Erro ao adicionar veículo:", error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Erro: Placa, RENAVAM ou Chassi já pertencem a outro veículo.' });
        }
        res.status(500).json({ error: 'Erro interno ao adicionar o veículo.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.put('/veiculos/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { userId, nome: nomeUsuario, perfil } = req.user;
    const allowedProfiles = ["Administrador", "Financeiro", "Logistica"];
    if (!allowedProfiles.includes(perfil)) {
        return res.status(403).json({ error: 'Você não tem permissão para executar esta ação.' });
    }

    const vehicleData = req.body;
    if (!vehicleData.placa || !vehicleData.marca || !vehicleData.modelo || !vehicleData.id_filial || !vehicleData.status) {
        return res.status(400).json({ error: 'Placa, marca, modelo, filial e status são obrigatórios.' });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const [currentVehicleRows] = await connection.execute('SELECT * FROM veiculos WHERE id = ?', [id]);
        if (currentVehicleRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Veículo não encontrado.' });
        }
        const currentVehicle = currentVehicleRows[0];
        
        const changesDescription = [];
        const camposParaComparar = ['placa', 'marca', 'modelo', 'ano_fabricacao', 'ano_modelo', 'renavam', 'chassi', 'id_filial', 'status', 'seguro', 'rastreador', 'tipo_combustivel'];
        
        for (const campo of camposParaComparar) {
            const valorAntigo = (campo === 'seguro' || campo === 'rastreador') ? Boolean(currentVehicle[campo]) : (currentVehicle[campo] || '');
            const valorNovo = (campo === 'seguro' || campo === 'rastreador') ? Boolean(vehicleData[campo]) : (vehicleData[campo] || '');
            if (String(valorAntigo) !== String(valorNovo)) {
                changesDescription.push(`${campo} de "${valorAntigo}" para "${valorNovo}"`);
            }
        }

        if (changesDescription.length > 0) {
            await registrarLog({
                usuario_id: userId, usuario_nome: nomeUsuario, tipo_entidade: 'Veículo',
                id_entidade: id, tipo_acao: 'Atualização',
                descricao: `Atualizou veículo ID ${id}: ${changesDescription.join(', ')}.`
            });
        }

        const updateSql = `
            UPDATE veiculos SET 
            placa = ?, marca = ?, modelo = ?, ano_fabricacao = ?, ano_modelo = ?, 
            renavam = ?, chassi = ?, id_filial = ?, status = ?,
            seguro = ?, rastreador = ?, tipo_combustivel = ? 
            WHERE id = ?`;
        
        await connection.execute(updateSql, [
            vehicleData.placa, vehicleData.marca, vehicleData.modelo, 
            vehicleData.ano_fabricacao || null, vehicleData.ano_modelo || null, 
            vehicleData.renavam || null, vehicleData.chassi || null, 
            vehicleData.id_filial, vehicleData.status,
            vehicleData.seguro ? 1 : 0, vehicleData.rastreador ? 1 : 0,
            vehicleData.tipo_combustivel || null,
            id
        ]);
        
        await connection.commit();
        res.json({ message: 'Veículo atualizado com sucesso!' });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Erro ao atualizar veículo:", error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Erro: Placa, RENAVAM ou Chassi já pertencem a outro veículo.' });
        }
        res.status(500).json({ error: 'Erro interno ao atualizar o veículo.' });
    } finally {
        if (connection) await connection.end();
    }
});


router.delete('/veiculos/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { userId, nome: nomeUsuario, perfil } = req.user;
    const allowedProfiles = ["Administrador", "Financeiro", "Logistica"];
    if (!allowedProfiles.includes(perfil)) {
        return res.status(403).json({ error: 'Você não tem permissão para executar esta ação.' });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const [vehicle] = await connection.execute('SELECT modelo, placa FROM veiculos WHERE id = ?', [id]);
        if (vehicle.length === 0) {
            return res.status(404).json({ message: 'Veículo não encontrado.' });
        }

        const [result] = await connection.execute('DELETE FROM veiculos WHERE id = ?', [id]);
        if (result.affectedRows > 0) {
             await registrarLog({
                usuario_id: userId, usuario_nome: nomeUsuario, tipo_entidade: 'Veículo',
                id_entidade: id, tipo_acao: 'Exclusão',
                descricao: `Excluiu o veículo ${vehicle[0].modelo} - ${vehicle[0].placa} (ID: ${id}).`
            });
        }
        
        await connection.commit();
        res.json({ message: 'Veículo apagado com sucesso.' });
    } catch (error) {
        if(connection) await connection.rollback();
        console.error("Erro ao apagar veículo:", error);
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(409).json({ error: 'Não é possível apagar este veículo pois ele possui registos associados (manutenções, etc.).' });
        }
        res.status(500).json({ error: 'Erro interno ao apagar o veículo.' });
    } finally {
        if (connection) await connection.end();
    }
});


// --- ROTAS DE UPLOAD, FOTOS, DOCUMENTOS E LOGS ---

router.post('/veiculos/:id/upload', authenticateToken, (req, res) => {
    const { perfil } = req.user;
    const allowedProfiles = ["Administrador", "Financeiro", "Logistica"];
    if (!allowedProfiles.includes(perfil)) {
        return res.status(403).json({ error: 'Você não tem permissão para executar esta ação.' });
    }

    vehicleUpload(req, res, async (err) => {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: "Erro: O ficheiro excede o limite de 3MB." });
        } else if (err) {
            console.error("Erro do Multer:", err);
            return res.status(500).json({ error: "Ocorreu um erro durante o upload." });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum ficheiro enviado.' });
        }

        const { id } = req.params;
        const { descricao } = req.body;
        const isPhoto = req.file.mimetype.startsWith('image/');
        
        let connection;
        let newPath;

        try {
            connection = await mysql.createConnection(dbConfig);
            
            const [vehicleRows] = await connection.execute('SELECT placa, modelo, ano_modelo FROM veiculos WHERE id = ?', [id]);
            if (vehicleRows.length === 0) {
                await fs.unlink(req.file.path); 
                return res.status(404).json({ error: 'Veículo não encontrado.' });
            }
            const vehicle = vehicleRows[0];

            const placa = sanitizeForPath(vehicle.placa);
            const modelo = sanitizeForPath(vehicle.modelo);
            const ano = vehicle.ano_modelo || new Date().getFullYear();
            const desc = sanitizeForPath(descricao);
            const extension = path.extname(req.file.originalname);
            const newFilename = `${placa}_${modelo}_${ano}_${desc}${extension}`;
            
            newPath = path.join(path.dirname(req.file.path), newFilename);
            await fs.rename(req.file.path, newPath);

            if (isPhoto) {
                const fotoSql = 'INSERT INTO veiculo_fotos (id_veiculo, descricao, caminho_foto) VALUES (?, ?, ?)';
                await connection.execute(fotoSql, [id, descricao, newFilename]);
            } else {
                const { data_validade } = req.body;
                const docSql = 'INSERT INTO veiculo_documentos (id_veiculo, nome_documento, data_validade, caminho_arquivo, data_upload, status) VALUES (?, ?, ?, ?, NOW(), ?)';
                await connection.execute(docSql, [id, descricao, data_validade || null, newFilename, 'Ativo']);
            }

            res.status(201).json({ message: 'Ficheiro carregado com sucesso!', fileName: newFilename });

        } catch (dbError) {
            const pathToClean = newPath || (req.file && req.file.path);
            if (pathToClean) {
                await fs.unlink(pathToClean).catch(e => console.error("Falha ao limpar o ficheiro após erro:", e));
            }
            console.error("Erro de base de dados ou ficheiro no upload:", dbError);
            res.status(500).json({ error: 'Erro ao salvar as informações do ficheiro.' });
        } finally {
            if (connection) await connection.end();
        }
    });
});

router.get('/veiculos/:id/fotos', authenticateToken, async (req, res) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        
        const [vehicleRows] = await connection.execute('SELECT placa FROM veiculos WHERE id = ?', [id]);
        if (vehicleRows.length === 0) {
            return res.status(404).json({ error: 'Veículo não encontrado.' });
        }
        const placaSanitizada = sanitizeForPath(vehicleRows[0].placa);

        const [fotos] = await connection.execute('SELECT id, id_veiculo, descricao, caminho_foto FROM veiculo_fotos WHERE id_veiculo = ?', [id]);
        
        const fotosComUrl = fotos.map(foto => ({
            ...foto,
            caminho_foto: `uploads/veiculos/${placaSanitizada}/fotos/${foto.caminho_foto}`
        }));

        res.json(fotosComUrl);
    } catch (error) {
        console.error("Erro ao buscar fotos:", error);
        res.status(500).json({ error: 'Erro ao buscar fotos do veículo.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/veiculos/:id/documentos', authenticateToken, async (req, res) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        
        const [vehicleRows] = await connection.execute('SELECT placa FROM veiculos WHERE id = ?', [id]);
        if (vehicleRows.length === 0) {
            return res.status(404).json({ error: 'Veículo não encontrado.' });
        }
        const placaSanitizada = sanitizeForPath(vehicleRows[0].placa);

        const [documentos] = await connection.execute("SELECT id, id_veiculo, nome_documento, data_validade, caminho_arquivo, data_upload FROM veiculo_documentos WHERE id_veiculo = ? AND status = 'Ativo' ORDER BY data_upload DESC", [id]);
        
        const documentosComUrl = documentos.map(doc => ({
            ...doc,
            caminho_arquivo: `uploads/veiculos/${placaSanitizada}/documentos/${doc.caminho_arquivo}`
        }));

        res.json(documentosComUrl);
    } catch (error) {
        console.error("Erro ao buscar documentos:", error);
        res.status(500).json({ error: 'Erro ao buscar documentos do veículo.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.put('/documentos/:docId/excluir', authenticateToken, async (req, res) => {
    const { docId } = req.params;
    const { userId, perfil } = req.user;
    const allowedProfiles = ["Administrador", "Financeiro", "Logistica"];
    if (!allowedProfiles.includes(perfil)) {
        return res.status(403).json({ error: 'Você não tem permissão para executar esta ação.' });
    }
    
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = "UPDATE veiculo_documentos SET status = 'Excluido', excluido_por_id = ?, data_exclusao = NOW() WHERE id = ?";
        const [result] = await connection.execute(sql, [userId, docId]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Documento não encontrado.' });
        }
        
        res.json({ message: 'Documento marcado como excluído com sucesso.' });
    } catch (error) {
        console.error("Erro ao excluir documento:", error);
        res.status(500).json({ error: 'Erro interno ao excluir o documento.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/veiculos/:id/logs', authenticateToken, async (req, res) => {
    const { perfil } = req.user;
    const allowedProfiles = ["Administrador", "Financeiro", "Logistica"];
    if (!allowedProfiles.includes(perfil)) {
        return res.status(403).json({ error: 'Você não tem permissão para visualizar os logs.' });
    }

    const { id } = req.params;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            SELECT * FROM logistica_logs 
            WHERE tipo_entidade = 'Veículo' AND id_entidade = ? 
            ORDER BY data_hora DESC`;
        const [logs] = await connection.execute(sql, [id]);
        res.json(logs);
    } catch (error) {
        console.error("Erro ao buscar logs do veículo:", error);
        res.status(500).json({ error: 'Erro ao buscar o histórico de alterações.' });
    } finally {
        if (connection) await connection.end();
    }
});

// --- ROTAS PARA O CADASTRO DE ITENS DE ESTOQUE ---

// Rota para buscar lista de itens (tabela itens_estoque)
router.get('/itens-estoque', authenticateToken, async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        // CORRIGIDO: Seleciona todas as colunas necessárias da tabela correta.
        const [rows] = await connection.execute('SELECT id, nome_item, unidade_medida, descricao, quantidade_atual FROM itens_estoque ORDER BY nome_item');
        res.json(rows);
    } catch (error) {
        console.error("Erro ao buscar itens de estoque:", error);
        res.status(500).json({ error: 'Erro ao buscar itens de estoque.' });
    } finally {
        if (connection) await connection.end();
    }
});

// Rotas CRUD para gerir os itens (tabela estoque_itens)
router.post('/itens-estoque', authenticateToken, authorizeAdmin, async (req, res) => {
    const { nome_item, unidade_medida, descricao } = req.body;
    if (!nome_item || !unidade_medida) return res.status(400).json({ error: 'Nome e unidade de medida são obrigatórios.' });
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        // CORRIGIDO: Insere na tabela correta "itens_estoque".
        const sql = 'INSERT INTO itens_estoque (nome_item, unidade_medida, descricao, quantidade_atual) VALUES (?, ?, ?, 0)';
        await connection.execute(sql, [nome_item, unidade_medida, descricao || null]);
        res.status(201).json({ message: 'Item criado com sucesso.' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Já existe um item com este nome.' });
        console.error("Erro ao criar item:", error);
        res.status(500).json({ error: 'Erro ao criar o item.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.put('/itens-estoque/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const { nome_item, unidade_medida, descricao } = req.body;
    if (!nome_item || !unidade_medida) return res.status(400).json({ error: 'Nome e unidade de medida são obrigatórios.' });
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        // CORRIGIDO: Atualiza a tabela correta "itens_estoque".
        const sql = 'UPDATE itens_estoque SET nome_item = ?, unidade_medida = ?, descricao = ? WHERE id = ?';
        await connection.execute(sql, [nome_item, unidade_medida, descricao || null, id]);
        res.json({ message: 'Item atualizado com sucesso.' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Já existe outro item com este nome.' });
        console.error("Erro ao atualizar item:", error);
        res.status(500).json({ error: 'Erro ao atualizar o item.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.delete('/itens-estoque/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        // CORRIGIDO: Apaga da tabela correta "itens_estoque".
        await connection.execute('DELETE FROM itens_estoque WHERE id = ?', [id]);
        res.json({ message: 'Item apagado com sucesso.' });
    } catch (error) {
        if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ error: 'Não é possível apagar este item, pois ele já possui movimentos de estoque registados.' });
        console.error("Erro ao apagar item:", error);
        res.status(500).json({ error: 'Erro ao apagar o item.' });
    } finally {
        if (connection) await connection.end();
    }
});

// --- ROTAS PARA O MÓDULO DE COMBUSTÍVEL ---

router.get('/estoque/saldo/:itemId', authenticateToken, async (req, res) => {
    const { itemId } = req.params;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute(
            "SELECT quantidade_atual, unidade_medida, ultimo_preco_unitario FROM itens_estoque WHERE id = ?",
            [itemId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: `Item de estoque com ID ${itemId} não encontrado.` });
        }
        res.json(rows[0]);

    } catch (error) {
        console.error("Erro ao buscar saldo de estoque:", error);
        res.status(500).json({ error: 'Erro ao buscar saldo de estoque.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.post('/estoque/entrada', authenticateToken, async (req, res) => {
    const { itemId, quantidade, custo, fornecedorId } = req.body;
    const { userId, nome: nomeUsuario, perfil } = req.user;
    
    const allowedProfiles = ["Administrador", "Financeiro", "Logistica"];
    if (!allowedProfiles.includes(perfil)) {
        return res.status(403).json({ error: 'Você não tem permissão para esta ação.' });
    }

    if (!itemId || !quantidade || !custo || !fornecedorId) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios.'});
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const precoUnitario = parseFloat(custo) / parseFloat(quantidade);

        await connection.execute(
            'UPDATE itens_estoque SET quantidade_atual = quantidade_atual + ?, ultimo_preco_unitario = ? WHERE id = ?',
            [quantidade, precoUnitario, itemId]
        );
        
        await connection.execute(
            'INSERT INTO estoque_movimentos (id_item, tipo_movimento, quantidade, id_usuario, observacao) VALUES (?, ?, ?, ?, ?)',
            [itemId, 'Entrada', quantidade, userId, `Compra de ${quantidade}L. Custo Total: R$ ${custo}`]
        );

        const [itemData] = await connection.execute('SELECT nome_item FROM itens_estoque WHERE id = ?', [itemId]);
        const nomeItem = itemData[0].nome_item;
        
        const filiaisParaRateio = [27, 36, 37, 38];
        const valorRateado = (parseFloat(custo) / filiaisParaRateio.length).toFixed(2);
        const sequencial = `CF-${Date.now()}`;
        
        const sqlCustoFrota = `
            INSERT INTO custos_frota 
            (descricao, custo, data_custo, id_fornecedor, id_user_lanc, status, id_filial, sequencial_rateio) 
            VALUES (?, ?, CURDATE(), ?, ?, 'Ativo', ?, ?)`;

        for (const id_filial of filiaisParaRateio) {
            await connection.execute(sqlCustoFrota, [
                `Compra de ${nomeItem}`, 
                valorRateado, 
                fornecedorId, 
                userId, 
                id_filial, 
                sequencial
            ]);
        }

        await registrarLog({
            usuario_id: userId, usuario_nome: nomeUsuario,
            tipo_entidade: 'Estoque', id_entidade: itemId,
            tipo_acao: 'Entrada', descricao: `Registou a compra de ${quantidade}L de ${nomeItem} e rateou o custo.`
        });
        
        await connection.commit();
        res.status(201).json({ message: 'Compra registada, estoque e custos atualizados com sucesso!' });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Erro ao registar entrada em estoque:", error);
        res.status(500).json({ error: 'Erro ao registar a entrada em estoque.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.post('/estoque/consumo', authenticateToken, async (req, res) => {
    // Odômetro agora é opcional, filialDestino é nova
    const { veiculoId, data, quantidade, odometro, isGalao, filialDestino } = req.body;
    const { userId, nome: nomeUsuario, perfil } = req.user;
    
    const allowedProfiles = ["Administrador", "Financeiro", "Logistica"];
    if (!allowedProfiles.includes(perfil)) {
        return res.status(403).json({ error: 'Você não tem permissão para esta ação.' });
    }

    // Nova validação flexível
    if ((!isGalao && !veiculoId) || (isGalao && !filialDestino) || !data || !quantidade) {
        return res.status(400).json({ error: 'Campos obrigatórios não preenchidos. Verifique se o veículo ou a filial de destino foi selecionado.' });
    }

    // Pega a hora atual do servidor no formato HH:MM:SS
    const horaAtual = new Date().toTimeString().split(' ')[0]; 
    
    // Combina a data enviada pelo formulário com a hora atual
    const dataHoraMovimento = `${data} ${horaAtual}`;

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();
        
        const itemId = 1; // ID do Óleo Diesel
        
        const [itemRows] = await connection.execute('SELECT quantidade_atual, ultimo_preco_unitario FROM itens_estoque WHERE id = ? FOR UPDATE', [itemId]);
        if (itemRows.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'Item de estoque "Óleo Diesel" não encontrado.' });
        }
        const item = itemRows[0];
        
        if (parseFloat(item.quantidade_atual) < parseFloat(quantidade)) {
            await connection.rollback();
            return res.status(400).json({ error: 'Saldo de diesel insuficiente em estoque.' });
        }

        await connection.execute('UPDATE itens_estoque SET quantidade_atual = quantidade_atual - ? WHERE id = ?', [quantidade, itemId]);
        
        let id_filial_movimento = null;
        let observacao;
        let logDescription;

        if (isGalao) {
            // Se for galão, busca o ID da filial pelo nome
            const [filialRows] = await connection.execute("SELECT ID FROM parametro WHERE NOME_PARAMETRO = ? AND COD_PARAMETRO = 'Unidades'", [filialDestino]);
            if (filialRows.length === 0) throw new Error(`Filial "${filialDestino}" não encontrada.`);
            id_filial_movimento = filialRows[0].ID;
            observacao = `Retirada de ${quantidade}L para galão (Destino: ${filialDestino}).`;
            logDescription = observacao;
        } else {
            // Se for veículo, busca a filial atual do veículo
            const [vehicleData] = await connection.execute('SELECT id_filial FROM veiculos WHERE id = ?', [veiculoId]);
            if (vehicleData.length === 0) throw new Error('Veículo não encontrado.');
            id_filial_movimento = vehicleData[0].id_filial;
            observacao = `Abastecimento de ${quantidade}L.`;
            logDescription = `Abasteceu ${quantidade}L no veículo ID ${veiculoId}. Odómetro: ${odometro || 'Não informado'}.`;
        }
        
        await connection.execute(
            'INSERT INTO estoque_movimentos (id_item, tipo_movimento, quantidade, id_veiculo, id_filial, odometro_no_momento, id_usuario, observacao, status, data_movimento) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [itemId, 'Saída', quantidade, veiculoId || null, id_filial_movimento, odometro || null, userId, observacao, 'Ativo', dataHoraMovimento] // <== AQUI USAMOS A NOVA VARIÁVEL
        );

        let consumoMedio = null;
        // Lógica de odômetro e consumo médio só executa se for para um veículo e se o odômetro for informado
        if (!isGalao && veiculoId && odometro) {
            const [ultimoAbastecimento] = await connection.execute(
                'SELECT odometro_no_momento, quantidade FROM estoque_movimentos WHERE id_veiculo = ? AND tipo_movimento = "Saída" AND status = "Ativo" AND id != LAST_INSERT_ID() ORDER BY data_movimento DESC, id DESC LIMIT 1',
                [veiculoId]
            );
            
            if (ultimoAbastecimento.length > 0) {
                const odometroAnterior = ultimoAbastecimento[0].odometro_no_momento;
                const litrosAbastecidosNaquelaVez = quantidade; // Usa a quantidade do abastecimento atual
                const distancia = odometro - odometroAnterior;
                if (distancia > 0 && litrosAbastecidosNaquelaVez > 0) {
                    consumoMedio = (distancia / litrosAbastecidosNaquelaVez).toFixed(2);
                }
            }
            
            await connection.execute('UPDATE veiculos SET odometro_atual = ? WHERE id = ?', [odometro, veiculoId]);
        }
        
        await registrarLog({
            usuario_id: userId, usuario_nome: nomeUsuario,
            tipo_entidade: 'Consumo', id_entidade: veiculoId || null,
            tipo_acao: 'Saída de Estoque', descricao: logDescription
        });
        
        await connection.commit();
        res.status(201).json({ message: 'Consumo registado com sucesso!', consumoMedio: consumoMedio });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Erro ao registar consumo:", error);
        res.status(500).json({ error: 'Erro ao registar o consumo.' });
    } finally {
        if (connection) await connection.end();
    }
});


router.delete('/estoque/movimento/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { userId, nome: nomeUsuario } = req.user;
    
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const [movimentoRows] = await connection.execute("SELECT * FROM estoque_movimentos WHERE id = ? FOR UPDATE", [id]);
        if (movimentoRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Movimento de estoque não encontrado.' });
        }
        
        const movimento = movimentoRows[0];
        const { id_item, tipo_movimento, quantidade, status, id_veiculo } = movimento;

        if (status === 'Estornado') {
            await connection.rollback();
            return res.status(400).json({ error: 'Este lançamento já foi estornado.' });
        }

        if (tipo_movimento === 'Saída') { // Estorno de um abastecimento
            // Devolve a quantidade ao estoque
            await connection.execute(
                'UPDATE itens_estoque SET quantidade_atual = quantidade_atual + ? WHERE id = ?',
                [quantidade, id_item]
            );

            // NOVO: Lógica para reverter o odômetro do veículo
            // 1. Buscar o último abastecimento VÁLIDO (penúltimo no geral) para este veículo
            const [penultimoAbastecimento] = await connection.execute(
                `SELECT odometro_no_momento FROM estoque_movimentos 
                 WHERE id_veiculo = ? AND status = 'Ativo' AND id != ?
                 ORDER BY data_movimento DESC, id DESC LIMIT 1`,
                [id_veiculo, id]
            );

            // 2. Definir o novo odômetro. Se não houver anterior, pode-se optar por 0 ou manter.
            //    Vamos usar o do penúltimo, ou 0 se não houver mais nenhum.
            const novoOdometro = penultimoAbastecimento.length > 0 ? penultimoAbastecimento[0].odometro_no_momento : 0;

            // 3. Atualizar o odômetro na tabela de veículos
            await connection.execute(
                "UPDATE veiculos SET odometro_atual = ? WHERE id = ?",
                [novoOdometro, id_veiculo]
            );

        } else if (tipo_movimento === 'Entrada') {
            await connection.execute(
                'UPDATE itens_estoque SET quantidade_atual = quantidade_atual - ? WHERE id = ?',
                [quantidade, id_item]
            );
        }

        await connection.execute("UPDATE estoque_movimentos SET status = 'Estornado' WHERE id = ?", [id]);

        await registrarLog({
            usuario_id: userId,
            usuario_nome: nomeUsuario,
            tipo_entidade: 'Estoque',
            id_entidade: id_item,
            tipo_acao: 'Estorno',
            descricao: `Estornou o movimento ID ${id} (Tipo: ${tipo_movimento}, Quantidade: ${quantidade}). Odômetro revertido.`
        });
        
        await connection.commit();
        res.json({ message: 'Lançamento estornado e odômetro atualizado com sucesso!' });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Erro ao estornar movimento:", error);
        res.status(500).json({ error: 'Erro interno ao processar o estorno.' });
    } finally {
        if (connection) await connection.end();
    }
});
// --- ROTAS DE MANUTENÇÃO, CUSTOS E FORNECEDORES ---

router.get('/veiculos/:id/manutencoes', authenticateToken, async (req, res) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            SELECT vm.*, u.nome_user as nome_utilizador, f.razao_social as nome_fornecedor
            FROM veiculo_manutencoes vm
            LEFT JOIN cad_user u ON vm.id_user_lanc = u.ID
            LEFT JOIN fornecedores f ON vm.id_fornecedor = f.id
            WHERE vm.id_veiculo = ? AND vm.status = 'Ativo'
            ORDER BY vm.data_manutencao DESC`;
        const [manutencoes] = await connection.execute(sql, [id]);
        res.json(manutencoes);
    } catch (error) {
        console.error("Erro ao buscar manutenções:", error);
        res.status(500).json({ error: 'Erro ao buscar manutenções.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.post('/veiculos/:id/manutencoes', authenticateToken, async (req, res) => {
    const { id: id_veiculo } = req.params;
    const { data_manutencao, descricao, custo, tipo_manutencao, classificacao_custo, id_fornecedor, numero_nf, item_servico, odometro_manutencao } = req.body;
    const { userId, nome: nomeUsuario } = req.user;

    if (!data_manutencao || !custo || !tipo_manutencao || !classificacao_custo || !id_fornecedor) {
        return res.status(400).json({ error: 'Todos os campos da manutenção são obrigatórios.' });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const [vehicleData] = await connection.execute('SELECT id_filial FROM veiculos WHERE id = ?', [id_veiculo]);
        if (vehicleData.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Veículo não encontrado.' });
        }
        const id_filial_veiculo = vehicleData[0].id_filial;

        const sqlInsert = `
            INSERT INTO veiculo_manutencoes 
            (id_veiculo, id_filial, data_manutencao, descricao, custo, tipo_manutencao, item_servico, odometro_manutencao, classificacao_custo, id_user_lanc, numero_nf, id_fornecedor, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Ativo')`;

        await connection.execute(sqlInsert, [id_veiculo, id_filial_veiculo, data_manutencao, descricao, custo, tipo_manutencao, item_servico || null, odometro_manutencao || null, classificacao_custo, userId, id_fornecedor, numero_nf]);
        
        if (classificacao_custo === 'Preventiva') {
            const proximaManutencao = new Date(data_manutencao);
            proximaManutencao.setMonth(proximaManutencao.getMonth() + 3);

            const sqlUpdateVeiculo = `
                UPDATE veiculos 
                SET data_ultima_manutencao = ?, data_proxima_manutencao = ? 
                WHERE id = ?`;
            await connection.execute(sqlUpdateVeiculo, [data_manutencao, proximaManutencao, id_veiculo]);
        }
        
        await registrarLog({
            usuario_id: userId,
            usuario_nome: nomeUsuario,
            tipo_entidade: 'Manutenção',
            id_entidade: id_veiculo,
            tipo_acao: 'Criação',
            numero_nf: numero_nf,
            descricao: `Registou manutenção (${tipo_manutencao}) para o veículo ID ${id_veiculo} no valor de R$ ${custo}.`
        });

        await connection.commit();
        res.status(201).json({ message: 'Manutenção registada com sucesso!' });

    } catch (error) {
        if(connection) await connection.rollback();
        console.error("Erro ao adicionar manutenção:", error);
        res.status(500).json({ error: 'Erro interno ao adicionar manutenção.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.put('/manutencoes/:id/excluir', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { userId, nome: nomeUsuario, perfil } = req.user;
    const allowedProfiles = ["Administrador", "Financeiro", "Logistica"];
    if (!allowedProfiles.includes(perfil)) {
        return res.status(403).json({ error: 'Você não tem permissão para executar esta ação.' });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            UPDATE veiculo_manutencoes 
            SET status = 'Excluída', excluido_por_id = ?, excluido_por_nome = ?, data_exclusao = NOW()
            WHERE id = ?`;
        const [result] = await connection.execute(sql, [userId, `${userId} - ${nomeUsuario}`, id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Lançamento de manutenção não encontrado.' });
        }
        res.json({ message: 'Lançamento de manutenção excluído com sucesso.' });
    } catch (error) {
        console.error("Erro ao excluir manutenção:", error);
        res.status(500).json({ error: 'Erro ao excluir o lançamento.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.post('/fornecedores/cnpj', authenticateToken, async (req, res) => {
    const { cnpj, razao_social, nome_fantasia, ...outrosDados } = req.body;
    if (!cnpj) return res.status(400).json({ error: 'CNPJ é obrigatório.' });
    
    const cleanedCnpj = cnpj.replace(/\D/g, '');
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        let [fornecedor] = await connection.execute('SELECT * FROM fornecedores WHERE cnpj = ?', [cleanedCnpj]);

        if (fornecedor.length > 0) {
            return res.json(fornecedor[0]);
        } else {
            if (!razao_social) {
                return res.status(400).json({ error: 'Razão Social é obrigatória para criar um novo fornecedor.' });
            }
            const sql = `
                INSERT INTO fornecedores (cnpj, razao_social, nome_fantasia, logradouro, numero, bairro, municipio, uf, cep)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            const [result] = await connection.execute(sql, [
                cleanedCnpj, razao_social, nome_fantasia || razao_social,
                outrosDados.logradouro || null, outrosDados.numero || null,
                outrosDados.bairro || null, outrosDados.municipio || null,
                outrosDados.uf || null, outrosDados.cep ? outrosDados.cep.replace(/\D/g, '') : null
            ]);
            
            const novoFornecedor = { id: result.insertId, cnpj: cleanedCnpj, razao_social, nome_fantasia: nome_fantasia || razao_social, ...outrosDados };
            return res.status(201).json(novoFornecedor);
        }
    } catch (error) {
        console.error("Erro ao gerir fornecedor:", error);
        res.status(500).json({ error: 'Erro interno ao gerir fornecedor.' });
    } finally {
        if (connection) await connection.end();
    }
});


// --- SEÇÃO DE CUSTOS DE FROTA ---

router.post('/custos-frota', authenticateToken, async (req, res) => {
    const { descricao, custo, data_custo, id_fornecedor, filiais_rateio, numero_nf } = req.body;
    const { userId, nome: nomeUsuario, perfil } = req.user;

    const allowedProfiles = ["Administrador", "Financeiro", "Logistica"];
    if (!allowedProfiles.includes(perfil)) {
        return res.status(403).json({ error: 'Você não tem permissão para executar esta ação.' });
    }

    if (!descricao || !custo || !data_custo || id_fornecedor == null || !filiais_rateio || !Array.isArray(filiais_rateio) || filiais_rateio.length === 0) {
        return res.status(400).json({ error: 'Dados inválidos.' });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();
        const sequencial = `CF-${Date.now()}`;
        const valorRateado = (parseFloat(custo) / filiais_rateio.length).toFixed(2);
        const sqlInsert = `INSERT INTO custos_frota (descricao, custo, data_custo, id_fornecedor, id_filial, sequencial_rateio, id_user_lanc, numero_nf, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Ativo')`;
        
        for (const id_filial of filiais_rateio) {
            await connection.execute(sqlInsert, [descricao, valorRateado, data_custo, id_fornecedor, id_filial, sequencial, userId, numero_nf]);
        }
        
        await registrarLog({
            usuario_id: userId,
            usuario_nome: nomeUsuario,
            tipo_entidade: 'Custo de Frota',
            id_entidade: null, 
            tipo_acao: 'Criação',
            numero_nf: numero_nf,
            descricao: `Criou custo de frota "${descricao}" (Seq: ${sequencial}) com valor total de R$ ${custo}.`
        });

        await connection.commit();
        res.status(201).json({ message: 'Custo de frota registado e rateado com sucesso!' });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Erro ao adicionar custo de frota:", error);
        res.status(500).json({ error: 'Erro interno ao adicionar custo de frota.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/custos-frota', authenticateToken, async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        const countQuery = `SELECT COUNT(*) as total FROM custos_frota WHERE status = 'Ativo'`;
        const dataQuery = `
            SELECT 
                cf.id, cf.descricao, cf.custo, cf.data_custo, cf.sequencial_rateio,
                cf.numero_nf,
                p.NOME_PARAMETRO as nome_filial,
                CASE WHEN cf.id_fornecedor = 0 THEN 'DESPESA INTERNA' ELSE f.razao_social END as nome_fornecedor,
                u.nome_user as nome_utilizador
            FROM custos_frota cf
            LEFT JOIN parametro p ON cf.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
            LEFT JOIN fornecedores f ON cf.id_fornecedor = f.id
            LEFT JOIN cad_user u ON cf.id_user_lanc = u.ID
            WHERE cf.status = 'Ativo'
            ORDER BY cf.data_custo DESC, cf.id DESC
            LIMIT ? OFFSET ?`;
        
        const [totalResult] = await connection.execute(countQuery);
        const totalItems = totalResult[0].total;
        const [data] = await connection.execute(dataQuery, [limit, offset]);
        
        res.json({
            totalItems,
            totalPages: Math.ceil(totalItems / limit),
            currentPage: page,
            data
        });
    } catch (error) {
        console.error("Erro ao buscar custos de frota:", error);
        res.status(500).json({ error: 'Erro ao buscar custos de frota.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/manutencoes/recentes', authenticateToken, async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        const countQuery = `SELECT COUNT(*) as total FROM veiculo_manutencoes WHERE status = 'Ativo'`;
        const dataQuery = `
            SELECT 
                vm.id, vm.data_manutencao as data_custo, vm.descricao, vm.custo,
                vm.numero_nf,
                v.placa, v.modelo, f.razao_social as nome_fornecedor, u.nome_user as nome_utilizador
            FROM veiculo_manutencoes vm
            JOIN veiculos v ON vm.id_veiculo = v.id
            LEFT JOIN fornecedores f ON vm.id_fornecedor = f.id
            LEFT JOIN cad_user u ON vm.id_user_lanc = u.ID
            WHERE vm.status = 'Ativo'
            ORDER BY vm.data_manutencao DESC
            LIMIT ? OFFSET ?`;

        const [totalResult] = await connection.execute(countQuery);
        const totalItems = totalResult[0].total;
        const [data] = await connection.execute(dataQuery, [limit, offset]);
        
        res.json({
            totalItems,
            totalPages: Math.ceil(totalItems / limit),
            currentPage: page,
            data
        });
    } catch (error) {
        console.error("Erro ao buscar custos individuais recentes:", error);
        res.status(500).json({ error: 'Erro ao buscar custos individuais.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.put('/custos-frota/:id/excluir', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { userId, nome: nomeUsuario, perfil } = req.user;

    const allowedProfiles = ["Administrador", "Financeiro", "Logistica"];
    if (!allowedProfiles.includes(perfil)) {
        return res.status(403).json({ error: 'Você não tem permissão para executar esta ação.' });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [cost] = await connection.execute('SELECT descricao, sequencial_rateio FROM custos_frota WHERE id = ?', [id]);
        if (cost.length === 0) {
            return res.status(404).json({ message: 'Custo de frota não encontrado.' });
        }
        
        await connection.execute(`UPDATE custos_frota SET status = 'Excluída', excluido_por_id = ?, excluido_por_nome = ?, data_exclusao = NOW() WHERE id = ?`, [userId, nomeUsuario, id]);
        
        await registrarLog({
            usuario_id: userId,
            usuario_nome: nomeUsuario,
            tipo_entidade: 'Custo de Frota',
            id_entidade: id,
            tipo_acao: 'Exclusão',
            descricao: `Excluiu o lançamento de custo de frota ID ${id} (Seq: ${cost[0].sequencial_rateio}).`
        });

        res.json({ message: 'Custo de frota excluído com sucesso.' });
    } catch (error) {
        console.error("Erro ao excluir custo de frota:", error);
        res.status(500).json({ error: 'Erro ao excluir o custo.' });
    } finally {
        if (connection) await connection.end();
    }
});

// --- ROTAS DE RELATÓRIOS ---

router.get('/relatorios/listaVeiculos', authenticateToken, async (req, res) => {
    const { filial, status, limit, seguro, rastreador } = req.query;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const params = [];
        let conditions = [];
        const pageLimit = parseInt(limit) || 1000;

        if (filial) { conditions.push('v.id_filial = ?'); params.push(filial); }
        if (status) {
            conditions.push('v.status = ?');
            params.push(status);
        } else {
            // Se nenhum status for enviado, o padrão é mostrar apenas os Ativos.
            conditions.push("v.status = 'Ativo'");
            if (seguro === 'true') { conditions.push('v.seguro = 1'); }
            if (rastreador === 'true') { conditions.push('v.rastreador = 1'); }

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            const sql = `
            SELECT 
                v.placa, v.marca, v.modelo, v.ano_fabricacao, v.ano_modelo, v.status,
                p.NOME_PARAMETRO as nome_filial, v.seguro, v.rastreador, v.odometro_atual,
                (SELECT MAX(data_manutencao) 
                 FROM veiculo_manutencoes 
                 WHERE id_veiculo = v.id AND classificacao_custo = 'Preventiva') as ultima_preventiva
            FROM veiculos v
            LEFT JOIN parametro p ON v.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
            ${whereClause}
            ORDER BY p.NOME_PARAMETRO, v.modelo
            LIMIT ?`;

            const [data] = await connection.execute(sql, [...params, pageLimit]);
            res.json(data);
        }
    } catch (error) {
        console.error("Erro ao gerar relatório de lista de veículos:", error);
        res.status(500).json({ error: 'Erro ao gerar relatório.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/relatorios/custoDireto', authenticateToken, async (req, res) => {
    const { filial, dataInicio, dataFim, limit } = req.query;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        let conditions = ["vm.status = 'Ativo'"];
        const params = [];
        const pageLimit = parseInt(limit) || 1000;

        if (filial) { conditions.push('v.id_filial = ?'); params.push(filial); }
        if (dataInicio) { conditions.push('vm.data_manutencao >= ?'); params.push(dataInicio); }
        if (dataFim) { conditions.push('vm.data_manutencao <= ?'); params.push(dataFim); }

        const whereClause = `WHERE ${conditions.join(' AND ')}`;
        const sql = `
            SELECT 
                p.NOME_PARAMETRO as filial_nome, 
                DATE_FORMAT(vm.data_manutencao, '%Y-%m-%d') as data_despesa,
                CONCAT(v.modelo, ' (', v.placa, ')') as veiculo_info, 
                vm.descricao as servico_info,
                vm.tipo_manutencao as tipo_despesa,
                f.razao_social as fornecedor_nome, 
                vm.custo as valor
                vm.numero_nf
            FROM veiculo_manutencoes vm
            JOIN veiculos v ON vm.id_veiculo = v.id
            LEFT JOIN fornecedores f ON vm.id_fornecedor = f.id
            LEFT JOIN parametro p ON v.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
            ${whereClause}
            ORDER BY p.NOME_PARAMETRO, vm.data_manutencao
            LIMIT ?`;
        
        const [data] = await connection.execute(sql, [...params, pageLimit]);
        res.json(data);
    } catch (error) {
        console.error("Erro ao gerar relatório de despesas diretas:", error);
        res.status(500).json({ error: 'Erro ao gerar relatório.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/relatorios/custoRateado', authenticateToken, async (req, res) => {
    const { filial, dataInicio, dataFim, limit } = req.query;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        let conditions = ["cf.status = 'Ativo'"];
        const params = [];
        const pageLimit = parseInt(limit) || 1000;

        if (dataInicio) { conditions.push('cf.data_custo >= ?'); params.push(dataInicio); }
        if (dataFim) { conditions.push('cf.data_custo <= ?'); params.push(dataFim); }
        if (filial) { conditions.push('cf.id_filial = ?'); params.push(filial); }
        
        const whereClause = `WHERE ${conditions.join(' AND ')}`;
        const sql = `
            SELECT 
                p.NOME_PARAMETRO as filial_nome, 
                p.ID as filial_id,
                'Despesa Rateada' as tipo_custo,
                NULL as veiculo_info,
                cf.descricao as servico_info,
                cf.custo as valor,
                cf.numero_nf,
                DATE_FORMAT(cf.data_custo, '%Y-%m-%d') as data_despesa
            FROM custos_frota cf
            LEFT JOIN parametro p ON cf.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
            ${whereClause}
            ORDER BY p.NOME_PARAMETRO, cf.data_custo
            LIMIT ?`;
        
        const [data] = await connection.execute(sql, [...params, pageLimit]);
        res.json(data);
    } catch (error) {
        console.error("Erro ao gerar relatório de custo rateado:", error);
        res.status(500).json({ error: 'Erro interno no servidor.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/relatorios/custoTotalFilial', authenticateToken, async (req, res) => {
    const { filial, dataInicio, dataFim } = req.query;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        
        const paramsDireto = [];
        let whereCustoDireto = "WHERE vm.status = 'Ativo'";
        if (filial) { whereCustoDireto += " AND v.id_filial = ?"; paramsDireto.push(filial); }
        if (dataInicio) { whereCustoDireto += " AND vm.data_manutencao >= ?"; paramsDireto.push(dataInicio); }
        if (dataFim) { whereCustoDireto += " AND vm.data_manutencao <= ?"; paramsDireto.push(dataFim); }

        const paramsRateado = [];
        let whereCustoRateado = "WHERE cf.status = 'Ativo'";
        if (dataInicio) { whereCustoRateado += " AND cf.data_custo >= ?"; paramsRateado.push(dataInicio); }
        if (dataFim) { whereCustoRateado += " AND cf.data_custo <= ?"; paramsRateado.push(dataFim); }
        if (filial) { whereCustoRateado += " AND cf.id_filial = ?"; paramsRateado.push(filial); }

        const sqlDireto = `
            SELECT 
                p.NOME_PARAMETRO as filial_nome, 
                p.ID as filial_id, 
                vm.tipo_manutencao as tipo_custo,
                CONCAT(v.modelo, ' (', v.placa, ')') as veiculo_info,
                vm.descricao as servico_info,
                vm.custo as valor,
                vm.numero_nf,
                DATE_FORMAT(vm.data_manutencao, '%Y-%m-%d') as data_despesa
            FROM veiculo_manutencoes vm
            JOIN veiculos v ON vm.id_veiculo = v.id
            LEFT JOIN parametro p ON v.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
            ${whereCustoDireto}`;

        const sqlRateado = `
            SELECT 
                p.NOME_PARAMETRO as filial_nome, 
                p.ID as filial_id, 
                'Despesa Rateada' as tipo_custo,
                NULL as veiculo_info,
                cf.descricao as servico_info,
                cf.custo as valor,
                cf.numero_nf,
                DATE_FORMAT(cf.data_custo, '%Y-%m-%d') as data_despesa
            FROM custos_frota cf
            LEFT JOIN parametro p ON cf.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
            ${whereCustoRateado}`;

        const [dataDireto] = await connection.execute(sqlDireto, paramsDireto);
        const [dataRateado] = await connection.execute(sqlRateado, paramsRateado);

        let combinedData = [...dataDireto, ...dataRateado];
        combinedData = combinedData.filter(item => item.filial_nome);
        combinedData.sort((a, b) => a.filial_nome.localeCompare(b.filial_nome) || a.tipo_custo.localeCompare(b.tipo_custo));

        res.json(combinedData);
    } catch (error) {
        console.error("Erro ao gerar relatório de custo total:", error);
        res.status(500).json({ error: 'Erro interno no servidor ao gerar o relatório.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/relatorios/despesaVeiculo', authenticateToken, async (req, res) => {
    const { veiculoId, dataInicio, dataFim, limit } = req.query;
    if (!veiculoId || !dataInicio || !dataFim) {
        return res.status(400).json({ error: 'ID do Veículo e período são obrigatórios.' });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const pageLimit = parseInt(limit) || 1000;

        // Query 1: Buscar os detalhes do veículo (como já fizemos)
        const vehicleDetailsSql = `
            SELECT v.marca, v.modelo, v.placa, p.NOME_PARAMETRO as nome_filial
            FROM veiculos v
            LEFT JOIN parametro p ON v.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
            WHERE v.id = ?`;
        const [vehicleDetails] = await connection.execute(vehicleDetailsSql, [veiculoId]);

        // Query 2: Buscar as MANUTENÇÕES (exceto abastecimentos)
        const maintenanceSql = `
            SELECT 
                data_manutencao as data_evento, tipo_manutencao as tipo, descricao,
                f.razao_social as fornecedor_nome, custo, numero_nf
            FROM veiculo_manutencoes vm
            LEFT JOIN fornecedores f ON vm.id_fornecedor = f.id
            WHERE vm.id_veiculo = ? AND vm.data_manutencao >= ? AND vm.data_manutencao <= ? 
              AND vm.status = 'Ativo' AND vm.tipo_manutencao != 'Abastecimento'`;
        
        // Query 3: Buscar os ABASTECIMENTOS e calcular o custo
        const fuelingSql = `
            SELECT 
                em.data_movimento as data_evento, 'Abastecimento' as tipo, 
                CONCAT(em.quantidade, 'L') as descricao, 'Posto Interno' as fornecedor_nome,
                (em.quantidade * ie.ultimo_preco_unitario) as custo,
                NULL as numero_nf
            FROM estoque_movimentos em
            JOIN itens_estoque ie ON em.id_item = ie.id
            WHERE em.id_veiculo = ? AND em.data_movimento >= ? AND em.data_movimento <= ?
              AND em.status = 'Ativo' AND em.tipo_movimento = 'Saída'`;

        const [manutencoes] = await connection.execute(maintenanceSql, [veiculoId, dataInicio, dataFim]);
        const [abastecimentos] = await connection.execute(fuelingSql, [veiculoId, dataInicio, dataFim]);

        // Juntar e ordenar os resultados por data
        const expenses = [...manutencoes, ...abastecimentos];
        expenses.sort((a, b) => new Date(a.data_evento) - new Date(b.data_evento));

        res.json({
            vehicle: vehicleDetails[0] || {},
            expenses: expenses.slice(0, pageLimit) // Aplica o limite após ordenar
        });

    } catch (error) {
        console.error("Erro ao gerar relatório de despesa de veículo:", error);
        res.status(500).json({ error: 'Erro ao gerar relatório.' });
    } finally {
        if (connection) await connection.end();
    }
});

// --- DASHBOARD E ALERTAS ---

router.get('/dashboard-summary', authenticateToken, async (req, res) => {
    const { dataInicio, dataFim, filial } = req.query;
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const params = [];
        let whereClauseVeiculos = "WHERE status IN ('Ativo', 'Em Manutenção')";
        if (filial) {
            whereClauseVeiculos += " AND id_filial = ?";
            params.push(filial);
        }

        const paramsCustos = [];
        let whereClauseCustos = "WHERE vm.status = 'Ativo'";
        if (dataInicio) { whereClauseCustos += " AND vm.data_manutencao >= ?"; paramsCustos.push(dataInicio); }
        if (dataFim) { whereClauseCustos += " AND vm.data_manutencao <= ?"; paramsCustos.push(dataFim); }
        if (filial) { whereClauseCustos += " AND v.id_filial = ?"; paramsCustos.push(filial); }
        
        const paramsDocs = [new Date(), new Date(new Date().setDate(new Date().getDate() + 30))];
        let whereClauseDocs = "WHERE d.data_validade BETWEEN ? AND ? AND d.status = 'Ativo'";
        if (filial) { whereClauseDocs += " AND v.id_filial = ?"; paramsDocs.push(filial); }


        const kpiVeiculosQuery = `SELECT COUNT(*) as total, status FROM veiculos ${whereClauseVeiculos} GROUP BY status`;
        const kpiCustoTotalQuery = `SELECT SUM(custo) as total FROM veiculo_manutencoes vm JOIN veiculos v ON vm.id_veiculo = v.id ${whereClauseCustos}`;
        const kpiDocsQuery = `SELECT COUNT(*) as total FROM veiculo_documentos d JOIN veiculos v ON d.id_veiculo = v.id ${whereClauseDocs}`;
        
        const chartCustoClassificacaoQuery = `SELECT classificacao_custo, SUM(custo) as total FROM veiculo_manutencoes vm JOIN veiculos v ON vm.id_veiculo = v.id ${whereClauseCustos} GROUP BY classificacao_custo`;
        const chartTop5VeiculosQuery = `SELECT CONCAT(v.modelo, ' - ', v.placa) as veiculo, SUM(vm.custo) as total FROM veiculo_manutencoes vm JOIN veiculos v ON vm.id_veiculo = v.id ${whereClauseCustos} GROUP BY vm.id_veiculo ORDER BY total DESC LIMIT 5`;

        const [
            veiculosResult,
            custoTotalResult,
            docsResult,
            custoClassificacaoResult,
            top5VeiculosResult,
        ] = await Promise.all([
            connection.execute(kpiVeiculosQuery, params),
            connection.execute(kpiCustoTotalQuery, paramsCustos),
            connection.execute(kpiDocsQuery, paramsDocs),
            connection.execute(chartCustoClassificacaoQuery, paramsCustos),
            connection.execute(chartTop5VeiculosQuery, paramsCustos)
        ]);

        const summary = {
            kpis: {
                veiculosAtivos: (veiculosResult[0].find(r => r.status === 'Ativo')?.total || 0),
                veiculosEmManutencao: (veiculosResult[0].find(r => r.status === 'Em Manutenção')?.total || 0),
                custoTotalPeriodo: custoTotalResult[0][0]?.total || 0,
                documentosAVencer: docsResult[0][0]?.total || 0,
            },
            charts: {
                statusFrota: veiculosResult[0],
                custoPorClassificacao: custoClassificacaoResult[0],
                top5VeiculosCusto: top5VeiculosResult[0],
            }
        };
        
        summary.kpis.totalVeiculos = summary.kpis.veiculosAtivos + summary.kpis.veiculosEmManutencao;

        res.json(summary);

    } catch (error) {
        console.error("Erro ao buscar dados do dashboard de logística:", error);
        res.status(500).json({ error: 'Erro interno ao buscar dados do dashboard de logística.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/veiculos/manutencao/vencidas', authenticateToken, async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            SELECT v.id, v.placa, v.modelo, v.data_proxima_manutencao, p.NOME_PARAMETRO as nome_filial 
            FROM veiculos v
            LEFT JOIN parametro p ON v.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
            WHERE v.data_proxima_manutencao < CURDATE() AND v.status = 'Ativo'
            ORDER BY v.data_proxima_manutencao ASC`;
        const [veiculos] = await connection.execute(sql);
        res.json(veiculos);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar veículos com manutenção vencida.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/veiculos/manutencao/a-vencer', authenticateToken, async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            SELECT v.id, v.placa, v.modelo, v.data_proxima_manutencao, p.NOME_PARAMETRO as nome_filial 
            FROM veiculos v
            LEFT JOIN parametro p ON v.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
            WHERE v.data_proxima_manutencao BETWEEN CURDATE() AND LAST_DAY(CURDATE()) AND v.status = 'Ativo'
            ORDER BY v.data_proxima_manutencao ASC`;
        const [veiculos] = await connection.execute(sql);
        res.json(veiculos);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar veículos com manutenção a vencer.' });
    } finally {
        if (connection) await connection.end();
    }
});

// --- OUTRAS ROTAS ---

router.get('/cnpj/:cnpj', authenticateToken, async (req, res) => {
    const { cnpj } = req.params;
    if (!cnpj) {
        return res.status(400).json({ error: 'CNPJ é obrigatório.' });
    }
    try {
        const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
        if (!response.ok) {
            throw new Error('CNPJ não encontrado ou serviço indisponível.');
        }
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error("Erro ao consultar BrasilAPI:", error);
        res.status(500).json({ error: 'Erro ao consultar o serviço de CNPJ.' });
    }
});

router.get('/abastecimentos', authenticateToken, async (req, res) => {
    const { filial } = req.query;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        let conditions = ["em.tipo_movimento = 'Saída'", "em.status = 'Ativo'"];
        const params = [];
        
        if (filial) {
            // Agora o filtro é aplicado na coluna id_filial do próprio movimento
            conditions.push("em.id_filial = ?");
            params.push(filial);
        }
        
        const whereClause = `WHERE ${conditions.join(' AND ')}`;

        const countQuery = `SELECT COUNT(*) as total FROM estoque_movimentos em ${whereClause}`;
            
        const dataQuery = `
            SELECT 
                em.id, em.data_movimento, em.quantidade, em.odometro_no_momento,
                v.placa, v.modelo, u.nome_user as nome_usuario, em.observacao,
                p.NOME_PARAMETRO as nome_filial
            FROM estoque_movimentos em
            LEFT JOIN veiculos v ON em.id_veiculo = v.id
            LEFT JOIN parametro p ON em.id_filial = p.ID
            JOIN cad_user u ON em.id_usuario = u.ID
            ${whereClause}
            ORDER BY em.data_movimento DESC, em.id DESC
            LIMIT ? OFFSET ?`;
        
        const [totalResult] = await connection.execute(countQuery, params);
        const totalItems = totalResult[0].total;
        const [data] = await connection.execute(dataQuery, [...params, limit, offset]);
        
        res.json({ totalItems, totalPages: Math.ceil(totalItems / limit), currentPage: page, data });
    } catch (error) {
        console.error("Erro ao buscar histórico de abastecimentos:", error);
        res.status(500).json({ error: 'Erro ao buscar histórico de abastecimentos.' });
    } finally {
        if (connection) await connection.end();
    }
});

// ROTA PARA BUSCAR ALERTAS DE MANUTENÇÃO POR KM
router.get('/veiculos/manutencao/alertas', authenticateToken, async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);

        const [planos] = await connection.execute(
            "SELECT NOME_PARAMETRO as item_servico, KEY_PARAMETRO as intervalo_km FROM parametro WHERE COD_PARAMETRO = 'Plano Manutencao KM' AND KEY_PARAMETRO > 0"
        );

        if (planos.length === 0) {
            return res.json([]);
        }

        const [veiculos] = await connection.execute(
            "SELECT id, modelo, placa, odometro_atual, id_filial FROM veiculos WHERE status = 'Ativo'"
        );

        const alertas = [];

        for (const veiculo of veiculos) {
            for (const plano of planos) {
                // CORREÇÃO APLICADA AQUI: Adicionado "AND status = 'Ativo'"
                const [ultimaManutencao] = await connection.execute(
                    `SELECT odometro_manutencao FROM veiculo_manutencoes 
                     WHERE id_veiculo = ? AND item_servico = ? AND odometro_manutencao IS NOT NULL AND status = 'Ativo'
                     ORDER BY data_manutencao DESC, id DESC LIMIT 1`,
                    [veiculo.id, plano.item_servico]
                );

                if (ultimaManutencao.length > 0) {
                    const odometroUltimoServico = ultimaManutencao[0].odometro_manutencao;
                    const kmDesdeUltimoServico = veiculo.odometro_atual - odometroUltimoServico;
                    const intervaloKmPlano = parseInt(plano.intervalo_km, 10);
                    
                    if (intervaloKmPlano > 0) { // Evita divisão por zero
                        const percentualUtilizado = (kmDesdeUltimoServico / intervaloKmPlano);
                        const proximaManutencaoKm = odometroUltimoServico + intervaloKmPlano;

                        if (percentualUtilizado >= 0.8) {
                            alertas.push({
                                veiculoId: veiculo.id,
                                veiculoDesc: `${veiculo.modelo} (${veiculo.placa})`,
                                itemServico: plano.item_servico,
                                kmAtual: veiculo.odometro_atual,
                                kmProxima: proximaManutencaoKm,
                                kmRestantes: proximaManutencaoKm - veiculo.odometro_atual,
                                status: (veiculo.odometro_atual >= proximaManutencaoKm) ? 'Vencida' : 'Próxima'
                            });
                        }
                    }
                }
            }
        }

        res.json(alertas);

    } catch (error) {
        console.error("Erro ao buscar alertas de manutenção:", error);
        res.status(500).json({ error: 'Erro ao buscar alertas de manutenção.' });
    } finally {
        if (connection) await connection.end();
    }
});

// ROTA PARA SALVAR UM NOVO CHECKLIST DE VEÍCULO (VERSÃO ATUALIZADA)
router.post('/checklist', authenticateToken, (req, res) => {
    checklistUpload(req, res, async (err) => {
        if (err) {
            console.error("Erro no Multer (checklist):", err);
            return res.status(500).json({ error: "Ocorreu um erro durante o upload das imagens." });
        }

        // Alterado: 'avarias' agora é 'checklist_items'
        const { id_veiculo, odometro_saida, observacoes_gerais, checklist_items } = req.body;
        const { userId } = req.user;

        if (!id_veiculo || !odometro_saida) {
            return res.status(400).json({ error: 'Veículo e Odômetro de Saída são obrigatórios.' });
        }

        let connection;
        try {
            connection = await mysql.createConnection(dbConfig);
            await connection.beginTransaction();

            const [veiculoRows] = await connection.execute('SELECT odometro_atual, id_filial, placa FROM veiculos WHERE id = ?', [id_veiculo]);
            if (veiculoRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: 'Veículo não encontrado.' });
            }
            const { odometro_atual: odometroAtual, id_filial: id_filial_veiculo, placa } = veiculoRows[0];

            if (parseInt(odometro_saida) < odometroAtual) {
                await connection.rollback();
                return res.status(400).json({ error: `Odômetro inválido. O valor informado (${odometro_saida} km) é inferior ao último registrado (${odometroAtual} km).` });
            }

            const dataHoje = new Date("2025-08-29T17:43:31.919Z").toISOString().slice(0, 10);
            const placaSanitizada = sanitizeForPath(placa);
            const finalDestPath = path.join(UPLOADS_BASE_PATH, 'veiculos', placaSanitizada, 'checklist', dataHoje);
            
            await fs.mkdir(finalDestPath, { recursive: true });

            for (const file of req.files) {
                const tempPath = file.path;
                const finalPath = path.join(finalDestPath, file.filename);
                await fs.rename(tempPath, finalPath);
            }

            // Salva o "cabeçalho" do checklist (sem alterações aqui)
            const checklistSql = `
                INSERT INTO veiculo_checklists (id_veiculo, id_usuario, id_filial, data_checklist, odometro_saida, observacoes_gerais)
                VALUES (?, ?, ?, NOW(), ?, ?)`;
            const [checklistResult] = await connection.execute(checklistSql, [id_veiculo, userId, id_filial_veiculo, odometro_saida, observacoes_gerais]);
            const newChecklistId = checklistResult.insertId;

            await connection.execute('UPDATE veiculos SET odometro_atual = ? WHERE id = ?', [odometro_saida, id_veiculo]);
            
            // ... (código para salvar fotos obrigatórias permanece o mesmo) ...
            const fotosObrigatorias = {};
            req.files.forEach(file => {
                if (['foto_frente', 'foto_traseira', 'foto_lateral_direita', 'foto_lateral_esquerda'].includes(file.fieldname)) {
                    fotosObrigatorias[file.fieldname] = file.filename;
                }
            });
            await connection.execute(
                `UPDATE veiculo_checklists SET foto_frente = ?, foto_traseira = ?, foto_lateral_direita = ?, foto_lateral_esquerda = ? WHERE id = ?`,
                [fotosObrigatorias.foto_frente, fotosObrigatorias.foto_traseira, fotosObrigatorias.foto_lateral_direita, fotosObrigatorias.foto_lateral_esquerda, newChecklistId]
            );

            // --- LÓGICA ALTERADA PARA SALVAR NA NOVA TABELA 'checklist_itens' ---
            if (checklist_items) {
                const itemsParsed = JSON.parse(checklist_items);
                const itemSql = `
                    INSERT INTO checklist_itens 
                    (id_checklist, data_checklist, id_filial, id_veiculo, placa, id_usuario, item_verificado, status, descricao_avaria, caminho_foto) 
                    VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?)`;

                for (const item of itemsParsed) {
                    let fotoFilename = null;
                    if (item.status === 'Avaria') {
                        const itemSanitized = item.item.replace(/\s+/g, '_').replace(/[^\w-]/g, '');
                        const fotoAvaria = req.files.find(f => f.fieldname === `avaria_foto_${itemSanitized}`);
                        if (fotoAvaria) {
                            fotoFilename = fotoAvaria.filename;
                        }
                    }
                    
                    await connection.execute(itemSql, [
                        newChecklistId,
                        id_filial_veiculo,
                        id_veiculo,
                        placa,
                        userId,
                        item.item,
                        item.status,
                        item.descricao || null,
                        fotoFilename
                    ]);
                }
            }
            // --- FIM DA LÓGICA ALTERADA ---
            
            await connection.commit();
            res.status(201).json({ message: 'Checklist salvo com sucesso!', checklistId: newChecklistId });

        } catch (error) {
            for (const file of req.files) {
                if(file && file.path) {
                    await fs.unlink(file.path).catch(e => console.error("Falha ao limpar arquivo temporário:", e.path));
                }
            }
            if (connection) await connection.rollback();
            console.error("Erro ao salvar checklist:", error);
            res.status(500).json({ error: 'Erro interno ao salvar o checklist.' });
        } finally {
            if (connection) await connection.end();
        }
    });
});

router.get('/veiculos-para-checklist', authenticateToken, async (req, res) => {
    const { perfil, unidade } = req.user;
    const privilegedProfiles = ["Administrador", "Logistica"];

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        
        let sql;
        let params = [];

        // A consulta SQL agora inclui um campo 'checklist_hoje'
        const baseQuery = `
            SELECT 
                v.id, v.modelo, v.placa, p.NOME_PARAMETRO as nome_filial,
                (SELECT COUNT(*) 
                 FROM veiculo_checklists vc 
                 WHERE vc.id_veiculo = v.id AND DATE(vc.data_checklist) = CURDATE()) as checklist_hoje
            FROM veiculos v
            LEFT JOIN parametro p ON v.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
        `;

        if (privilegedProfiles.includes(perfil)) {
            sql = `${baseQuery} WHERE v.status = 'Ativo' ORDER BY v.modelo`;
        } else {
            sql = `${baseQuery} WHERE v.status = 'Ativo' AND p.NOME_PARAMETRO = ? ORDER BY v.modelo`;
            params.push(unidade);
        }

        const [vehicles] = await connection.execute(sql, params);
        res.json(vehicles);

    } catch (error) {
        console.error("Erro ao buscar veículos para checklist:", error);
        res.status(500).json({ error: 'Erro ao buscar a lista de veículos.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/checklists-por-periodo', authenticateToken, async (req, res) => {
    const { dataInicio, dataFim } = req.query;
    if (!dataInicio || !dataFim) {
        return res.status(400).json({ error: 'Data de início e fim são obrigatórias.' });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);

        // 1. Busca os checklists CONCLUÍDOS no período (sem alteração aqui)
        const completedSql = `
            SELECT 
                vc.id, vc.id_veiculo, vc.data_checklist, v.modelo, v.placa,
                p.NOME_PARAMETRO as nome_filial, u.nome_user as nome_usuario,
                (SELECT COUNT(*) FROM checklist_itens ci WHERE ci.id_checklist = vc.id AND ci.status = 'Avaria') as total_avarias
            FROM veiculo_checklists vc
            JOIN veiculos v ON vc.id_veiculo = v.id
            JOIN cad_user u ON vc.id_usuario = u.ID
            LEFT JOIN parametro p ON vc.id_filial = p.ID
            WHERE DATE(vc.data_checklist) BETWEEN ? AND ?
            ORDER BY vc.data_checklist DESC`;
        const [completed] = await connection.execute(completedSql, [dataInicio, dataFim]);

        // 2. LÓGICA OTIMIZADA: Busca veículos PENDENTES usando LEFT JOIN
        const pendingSql = `
            SELECT v.id, v.modelo, v.placa, p.NOME_PARAMETRO as nome_filial, p.ID as id_filial
            FROM veiculos v
            LEFT JOIN veiculo_checklists vc ON v.id = vc.id_veiculo AND DATE(vc.data_checklist) BETWEEN ? AND ?
            LEFT JOIN parametro p ON v.id_filial = p.ID
            WHERE v.status = 'Ativo' AND vc.id IS NULL`;
        const [pending] = await connection.execute(pendingSql, [dataInicio, dataFim]);
        
        res.json({ completed, pending });

    } catch (error) {
        console.error("Erro ao buscar checklists por período:", error);
        res.status(500).json({ error: 'Erro ao buscar os checklists.' });
    } finally {
        if (connection) await connection.end();
    }
});

// Rota para desbloquear (excluir) um checklist
router.delete('/checklist/:id/desbloquear', authenticateToken, async (req, res) => {
    const { id: checklistId } = req.params;
    const { userId, nome: nomeUsuario } = req.user;

    // Apenas perfis privilegiados podem desbloquear
    if (!privilegedAccessProfiles.includes(req.user.perfil)) {
        return res.status(403).json({ error: 'Você não tem permissão para executar esta ação.' });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        // Pega o id_veiculo para o log antes de deletar
        const [checklist] = await connection.execute('SELECT id_veiculo FROM veiculo_checklists WHERE id = ?', [checklistId]);
        if (checklist.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Checklist não encontrado.' });
        }

        // Deleta primeiro os itens (se houver), depois o checklist principal
        await connection.execute('DELETE FROM checklist_itens WHERE id_checklist = ?', [checklistId]);
        await connection.execute('DELETE FROM veiculo_checklists WHERE id = ?', [checklistId]);

        await registrarLog({
            usuario_id: userId,
            usuario_nome: nomeUsuario,
            tipo_entidade: 'Checklist',
            id_entidade: checklist[0].id_veiculo,
            tipo_acao: 'Desbloqueio',
            descricao: `Desbloqueou (excluiu) o checklist ID ${checklistId} para permitir um novo registro.`
        });

        await connection.commit();
        res.json({ message: 'Checklist desbloqueado com sucesso!' });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Erro ao desbloquear checklist:", error);
        res.status(500).json({ error: 'Erro interno ao desbloquear o checklist.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/relatorios/abastecimento', authenticateToken, async (req, res) => {
    const { filial, dataInicio, dataFim, limit } = req.query;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        
        let conditions = ["em.tipo_movimento = 'Saída'", "em.status = 'Ativo'"];
        const params = [];
        const pageLimit = parseInt(limit) || 1000;

        if (filial) {
            conditions.push("em.id_filial = ?");
            params.push(filial);
        }
        if (dataInicio) {
            conditions.push("em.data_movimento >= ?");
            params.push(dataInicio);
        }
        if (dataFim) {
            conditions.push("em.data_movimento <= ?");
            params.push(dataFim);
        }
        
        const whereClause = `WHERE ${conditions.join(' AND ')}`;

        const sql = `
            SELECT 
                em.data_movimento,
                em.quantidade,
                em.odometro_no_momento,
                v.placa, 
                v.modelo, 
                p.NOME_PARAMETRO as nome_filial,
                (em.quantidade * ie.ultimo_preco_unitario) as custo_estimado
            FROM estoque_movimentos em
            LEFT JOIN veiculos v ON em.id_veiculo = v.id
            LEFT JOIN parametro p ON em.id_filial = p.ID
            JOIN itens_estoque ie ON em.id_item = ie.id
            ${whereClause}
            ORDER BY p.NOME_PARAMETRO, em.data_movimento ASC
            LIMIT ?`;
        
        const [data] = await connection.execute(sql, [...params, pageLimit]);
        res.json(data);

    } catch (error) {
        console.error("Erro ao gerar relatório de abastecimento:", error);
        res.status(500).json({ error: 'Erro ao gerar relatório de abastecimento.' });
    } finally {
        if (connection) await connection.end();
    }
});

module.exports = router;