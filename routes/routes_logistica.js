// routes/routes_logistica.js (VERSÃO COMPLETA E FINAL)

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
        
        const vehiclesWithPhotoUrl = vehicles.map(vehicle => {
             const placaSanitizada = sanitizeForPath(vehicle.placa);
             const fotoPrincipalPath = vehicle.foto_principal 
                ? `uploads/veiculos/${placaSanitizada}/fotos/${vehicle.foto_principal}` 
                : null;
             const fotoFrentePath = vehicle.foto_frente
                ? `uploads/veiculos/${placaSanitizada}/fotos/${vehicle.foto_frente}`
                : null;

            return {
                ...vehicle,
                foto_principal: fotoPrincipalPath,
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

router.post('/veiculos', authenticateToken, authorizeAdmin, async (req, res) => {
    const { placa, marca, modelo, ano_fabricacao, ano_modelo, renavam, chassi, id_filial, status } = req.body;

    if (!placa || !marca || !modelo || !id_filial || !status) {
        return res.status(400).json({ error: 'Placa, marca, modelo, filial e status são obrigatórios.' });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const sql = `
            INSERT INTO veiculos 
            (placa, marca, modelo, ano_fabricacao, ano_modelo, renavam, chassi, id_filial, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            
        const params = [placa, marca, modelo, ano_fabricacao || null, ano_modelo || null, renavam || null, chassi || null, id_filial, status];
        const [result] = await connection.execute(sql, params);
        const newVehicleId = result.insertId;

        const placaSanitizada = sanitizeForPath(placa);
        const vehicleDir = path.join(UPLOADS_BASE_PATH, 'veiculos', placaSanitizada);
        await fs.mkdir(path.join(vehicleDir, 'fotos'), { recursive: true });
        await fs.mkdir(path.join(vehicleDir, 'documentos'), { recursive: true });
        
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

router.put('/veiculos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const { userId, nome: nomeUsuario } = req.user;
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

        const logs = [];
        const camposParaComparar = ['placa', 'marca', 'modelo', 'ano_fabricacao', 'ano_modelo', 'renavam', 'chassi', 'id_filial', 'status'];
        
        for (const campo of camposParaComparar) {
            const valorAntigo = currentVehicle[campo] || '';
            const valorNovo = vehicleData[campo] || '';
            
            if (String(valorAntigo) !== String(valorNovo)) {
                logs.push([id, campo, String(valorAntigo), String(valorNovo), userId, nomeUsuario]);
            }
        }

        if (logs.length > 0) {
            const logSql = 'INSERT INTO veiculos_logs (id_veiculo, campo_alterado, valor_antigo, valor_novo, alterado_por_id, alterado_por_nome) VALUES ?';
            await connection.query(logSql, [logs]);
        }

        const updateSql = `
            UPDATE veiculos SET 
            placa = ?, marca = ?, modelo = ?, ano_fabricacao = ?, ano_modelo = ?, 
            renavam = ?, chassi = ?, id_filial = ?, status = ? 
            WHERE id = ?`;
        
        await connection.execute(updateSql, [
            vehicleData.placa, vehicleData.marca, vehicleData.modelo, 
            vehicleData.ano_fabricacao || null, vehicleData.ano_modelo || null, 
            vehicleData.renavam || null, vehicleData.chassi || null, 
            vehicleData.id_filial, vehicleData.status, id
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

router.delete('/veiculos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [result] = await connection.execute('DELETE FROM veiculos WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Veículo não encontrado.' });
        }
        res.json({ message: 'Veículo apagado com sucesso.' });
    } catch (error) {
        console.error("Erro ao apagar veículo:", error);
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(409).json({ error: 'Não é possível apagar este veículo pois ele possui registos associados (manutenções, documentos, etc.).' });
        }
        res.status(500).json({ error: 'Erro interno ao apagar o veículo.' });
    } finally {
        if (connection) await connection.end();
    }
});


// --- ROTAS DE UPLOAD, FOTOS, DOCUMENTOS E LOGS ---

router.post('/veiculos/:id/upload', authenticateToken, authorizeAdmin, (req, res) => {
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
                
                if (descricao.toLowerCase() === 'frente') {
                    const updatePrincipalSql = 'UPDATE veiculos SET foto_principal = ? WHERE id = ?';
                    await connection.execute(updatePrincipalSql, [newFilename, id]);
                }
            } else {
                const { data_validade } = req.body;
                const docSql = 'INSERT INTO veiculo_documentos (id_veiculo, nome_documento, data_validade, caminho_arquivo, data_inclusao, status) VALUES (?, ?, ?, ?, NOW(), ?)';
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

        const [documentos] = await connection.execute("SELECT id, id_veiculo, nome_documento, data_validade, caminho_arquivo, data_inclusao FROM veiculo_documentos WHERE id_veiculo = ? AND status = 'Ativo' ORDER BY data_inclusao DESC", [id]);
        
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

router.put('/documentos/:docId/excluir', authenticateToken, authorizeAdmin, async (req, res) => {
    const { docId } = req.params;
    const { userId } = req.user;
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

router.get('/veiculos/:id/logs', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            SELECT * FROM veiculos_logs 
            WHERE id_veiculo = ? 
            ORDER BY data_alteracao DESC`;
        const [logs] = await connection.execute(sql, [id]);
        res.json(logs);
    } catch (error) {
        console.error("Erro ao buscar logs do veículo:", error);
        res.status(500).json({ error: 'Erro ao buscar o histórico de alterações.' });
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
            LEFT JOIN cade_user u ON vm.id_user_lanc = u.ID
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
    const { data_manutencao, descricao, custo, tipo_manutencao, id_fornecedor } = req.body;
    const { userId } = req.user;

    if (!data_manutencao || !custo || !tipo_manutencao || !id_fornecedor) {
        return res.status(400).json({ error: 'Todos os campos da manutenção são obrigatórios.' });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            INSERT INTO veiculo_manutencoes (id_veiculo, data_manutencao, descricao, custo, tipo_manutencao, id_user_lanc, id_fornecedor, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Ativo')`;
        await connection.execute(sql, [id_veiculo, data_manutencao, descricao, custo, tipo_manutencao, userId, id_fornecedor]);
        res.status(201).json({ message: 'Manutenção registada com sucesso!' });
    } catch (error) {
        console.error("Erro ao adicionar manutenção:", error);
        res.status(500).json({ error: 'Erro interno ao adicionar manutenção.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.put('/manutencoes/:id/excluir', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const { userId, nome: nomeUsuario } = req.user;
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

// =================================================================
// SEÇÃO DE CUSTOS DE FROTA (COM TODAS AS CORREÇÕES)
// =================================================================

router.post('/custos-frota', authenticateToken, authorizeAdmin, async (req, res) => {
    const { descricao, custo, data_custo, id_fornecedor, filiais_rateio } = req.body;
    const { userId } = req.user;

    if (!descricao || !custo || !data_custo || id_fornecedor == null || !filiais_rateio || !Array.isArray(filiais_rateio) || filiais_rateio.length === 0) {
        return res.status(400).json({ error: 'Dados inválidos. Todos os campos são obrigatórios e pelo menos uma filial deve ser selecionada.' });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const sequencial = `CF-${Date.now()}`;
        const custoTotal = parseFloat(custo);
        const numeroDeFiliais = filiais_rateio.length;
        const valorRateado = (custoTotal / numeroDeFiliais).toFixed(2);

        const sqlInsert = `
            INSERT INTO custos_frota 
            (descricao, custo, data_custo, id_fornecedor, id_filial, sequencial_rateio, id_user_lanc, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Ativo')`;

        for (const id_filial of filiais_rateio) {
            await connection.execute(sqlInsert, [descricao, valorRateado, data_custo, id_fornecedor, id_filial, sequencial, userId]);
        }
        
        await connection.commit();
        res.status(201).json({ message: 'Custo de frota registado e rateado com sucesso!' });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Erro ao adicionar e ratear custo de frota:", error);
        res.status(500).json({ error: `Erro interno ao adicionar custo de frota: ${error.message}` });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/custos-frota', authenticateToken, async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            SELECT 
                cf.id,
                cf.descricao,
                cf.custo,
                cf.data_custo,
                cf.sequencial_rateio,
                p.NOME_PARAMETRO as nome_filial,
                CASE 
                    WHEN cf.id_fornecedor = 0 THEN 'DESPESA INTERNA'
                    ELSE f.razao_social 
                END as nome_fornecedor,
                u.nome_user as nome_utilizador
            FROM custos_frota cf
            LEFT JOIN parametro p ON cf.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
            LEFT JOIN fornecedores f ON cf.id_fornecedor = f.id
            LEFT JOIN cade_user u ON cf.id_user_lanc = u.ID
            WHERE cf.status = 'Ativo'
            ORDER BY cf.data_custo DESC`;
        const [custos] = await connection.execute(sql);
        res.json(custos);
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
        const sql = `
            SELECT 
                vm.id, vm.data_manutencao as data_custo, vm.descricao, vm.custo,
                v.placa, v.modelo, f.razao_social as nome_fornecedor, u.nome_user as nome_utilizador
            FROM veiculo_manutencoes vm
            JOIN veiculos v ON vm.id_veiculo = v.id
            LEFT JOIN fornecedores f ON vm.id_fornecedor = f.id
            LEFT JOIN cade_user u ON vm.id_user_lanc = u.ID
            WHERE vm.status = 'Ativo'
            ORDER BY vm.data_manutencao DESC
            LIMIT 50`;
        const [custos] = await connection.execute(sql);
        res.json(custos);
    } catch (error) {
        console.error("Erro ao buscar custos individuais recentes:", error);
        res.status(500).json({ error: 'Erro ao buscar custos individuais.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.put('/custos-frota/:id/excluir', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const { userId, nome: nomeUsuario } = req.user;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            UPDATE custos_frota 
            SET status = 'Excluída', excluido_por_id = ?, excluido_por_nome = ?, data_exclusao = NOW()
            WHERE id = ?`;
        const [result] = await connection.execute(sql, [userId, `${userId} - ${nomeUsuario}`, id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Custo de frota não encontrado.' });
        }
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
    const { filial, status } = req.query;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        let conditions = [];
        const params = [];

        if (filial) { conditions.push('v.id_filial = ?'); params.push(filial); }
        if (status) { conditions.push('v.status = ?'); params.push(status); }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const sql = `
            SELECT v.placa, v.marca, v.modelo, v.ano_fabricacao, v.ano_modelo, v.renavam, v.status, p.NOME_PARAMETRO as nome_filial
            FROM veiculos v
            LEFT JOIN parametro p ON v.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
            ${whereClause}
            ORDER BY p.NOME_PARAMETRO, v.modelo`;
        
        const [data] = await connection.execute(sql, params);
        res.json(data);
    } catch (error) {
        console.error("Erro ao gerar relatório de lista de veículos:", error);
        res.status(500).json({ error: 'Erro ao gerar relatório.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/relatorios/custoDireto', authenticateToken, async (req, res) => {
    const { filial, dataInicio, dataFim } = req.query;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        let conditions = ["vm.status = 'Ativo'"];
        const params = [];

        if (filial) { conditions.push('v.id_filial = ?'); params.push(filial); }
        if (dataInicio) { conditions.push('vm.data_manutencao >= ?'); params.push(dataInicio); }
        if (dataFim) { conditions.push('vm.data_manutencao <= ?'); params.push(dataFim); }

        const whereClause = `WHERE ${conditions.join(' AND ')}`;
        const sql = `
            SELECT 
                p.NOME_PARAMETRO as filial_nome, DATE_FORMAT(vm.data_manutencao, '%Y-%m-%d') as data_despesa,
                CONCAT(v.modelo, ' (', v.placa, ')') as descricao, vm.tipo_manutencao as tipo_despesa,
                f.razao_social as fornecedor_nome, vm.custo as valor
            FROM veiculo_manutencoes vm
            JOIN veiculos v ON vm.id_veiculo = v.id
            LEFT JOIN fornecedores f ON vm.id_fornecedor = f.id
            LEFT JOIN parametro p ON v.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
            ${whereClause}
            ORDER BY p.NOME_PARAMETRO, vm.data_manutencao`;
        
        const [data] = await connection.execute(sql, params);
        res.json(data);
    } catch (error) {
        console.error("Erro ao gerar relatório de despesas diretas:", error);
        res.status(500).json({ error: 'Erro ao gerar relatório.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/relatorios/custoRateado', authenticateToken, async (req, res) => {
    const { filial, dataInicio, dataFim } = req.query;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        let conditions = ["cf.status = 'Ativo'"];
        const params = [];

        if (dataInicio) { conditions.push('cf.data_custo >= ?'); params.push(dataInicio); }
        if (dataFim) { conditions.push('cf.data_custo <= ?'); params.push(dataFim); }
        if (filial) { conditions.push('cf.id_filial = ?'); params.push(filial); }
        
        const whereClause = `WHERE ${conditions.join(' AND ')}`;
        const sql = `
            SELECT 
                p.NOME_PARAMETRO as filial_nome,
                p.ID as filial_id,
                'Despesa Rateada' as tipo_custo,
                cf.descricao,
                cf.custo as valor
            FROM custos_frota cf
            LEFT JOIN parametro p ON cf.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
            ${whereClause}
            ORDER BY p.NOME_PARAMETRO, cf.data_custo`;
        
        const [data] = await connection.execute(sql, params);
        res.json(data);
    } catch (error) {
        console.error("Erro ao gerar relatório de custo rateado:", error);
        res.status(500).json({ error: 'Erro interno no servidor ao gerar o relatório.' });
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
                p.NOME_PARAMETRO as filial_nome, p.ID as filial_id, 'Despesa Direta' as tipo_custo,
                CONCAT(v.modelo, ' (', v.placa, ')') as descricao, vm.custo as valor
            FROM veiculo_manutencoes vm
            JOIN veiculos v ON vm.id_veiculo = v.id
            LEFT JOIN parametro p ON v.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
            ${whereCustoDireto}`;

        const sqlRateado = `
            SELECT 
                p.NOME_PARAMETRO as filial_nome, p.ID as filial_id, 'Despesa Rateada' as tipo_custo,
                cf.descricao,
                cf.custo as valor
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

module.exports = router;