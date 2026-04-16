const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken } = require('../middlewares');
const dbConfig = require('../dbConfig');

const dbConfigSei = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE_SEI,
    charset: 'utf8mb4'
};

const seiPool = mysql.createPool(dbConfigSei);
const gerencialPool = mysql.createPool(dbConfig);

// ==========================================================
//               FUNÇÃO DE CÁLCULO DE SALDO (CORRIGIDA)
// ==========================================================

function calcularSaldosItem(itemErp, retiradaManualDoItem, entregaRomaneioDoItem) {
    const quantidadeComprada = parseFloat(itemErp.it_quan) || 0;
    const totalEntregueErp = parseFloat(itemErp.it_qent) || 0;
    const totalDevolvido = parseFloat(itemErp.it_qtdv) || 0; 

    // 1. A quantidade real que o cliente tem direito de levar (Tira a devolução)
    const quantidadeLiquidaDireito = quantidadeComprada - totalDevolvido;

    // 2. O que já está fisicamente fora da loja (Entregue no ERP + Em Rota no App)
    const totalEmRomaneioApp = parseFloat(entregaRomaneioDoItem?.total) || 0;
    const totalJaDespachado = totalEntregueErp + totalEmRomaneioApp;

    // 3. O Saldo final a entregar agora
    const saldo = quantidadeLiquidaDireito - totalJaDespachado;

    return {
        saldo: Math.max(0, saldo), 
        entregue: totalJaDespachado,
        devolvido: totalDevolvido // Exportado para exibir na Retirada de Balcão e Romaneio
    };
}

function parseUsuarioLiberacao(it_entr) {
    if (!it_entr || typeof it_entr !== 'string') return 'N/A';
    const parts = it_entr.split(' ');
    return parts[parts.length - 1] || 'N/A';
}

function parseRetiradasAnteriores(it_reti) {
    if (!it_reti || typeof it_reti !== 'string') return 0;
    let totalRetirado = 0;
    const regex = /Retirada\.\.:\s*(\d+[\.,]?\d*)/g;
    let match;
    while ((match = regex.exec(it_reti)) !== null) {
        totalRetirado += parseFloat(match[1].replace(',', '.'));
    }
    return totalRetirado;
}

// ==========================================================
//               ROTAS DE RETIRADA RÁPIDA (BALCÃO)
// ==========================================================

router.get('/dav/:numero', authenticateToken, async (req, res) => {
    const davNumberStr = req.params.numero;
    const davNumber = parseInt(davNumberStr, 10);
    const { unidade: filialUsuario } = req.user;

    if (isNaN(davNumber)) return res.status(400).json({ error: 'Número do DAV inválido.' });

    try {
        const filialMap = {
            'Santa Cruz da Serra': 'LUCAM',
            'Piabetá': 'VMNAF',
            'Parada Angélica': 'TNASC',
            'Nova Campinas': 'LCMAT'
        };

        const adminFiliais = ['escritorio', 'escritório (lojas)'];
        const filialUsuarioNormalizada = filialUsuario ? filialUsuario.trim().toLowerCase() : '';
        const needsFilialFilter = !adminFiliais.includes(filialUsuarioNormalizada);

        let davQuery = `
            SELECT 
                c.cr_ndav, c.cr_nmcl, c.cr_dade, c.cr_refe, c.cr_ebai, c.cr_ecid, c.cr_ecep, 
                c.cr_edav, c.cr_hdav, c.cr_udav, c.cr_tnot, c.cr_tipo, c.cr_reca,
                c.cr_urec, c.cr_erec, c.cr_hrec, 
                c.cr_ecan, c.cr_hcan, c.cr_usac,
                c.cr_nfem, c.cr_chnf, c.cr_seri, c.cr_tnfs, c.cr_nota,
                c.cr_fili, c.cr_inde,
                cl.cl_docume 
             FROM cdavs c
             LEFT JOIN clientes cl ON c.cr_cdcl = cl.cl_codigo
             WHERE CAST(c.cr_ndav AS UNSIGNED) = ?
        `;
        const queryParams = [davNumber];

        if (needsFilialFilter) {
            const filialCode = filialMap[filialUsuario];
            if (!filialCode) return res.status(404).json({ error: `Acesso negado para a sua filial.` });
            davQuery += ' AND c.cr_inde = ?';
            queryParams.push(filialCode);
        }

        const [davs] = await seiPool.execute(davQuery, queryParams);
        if (davs.length === 0) return res.status(404).json({ error: `Pedido não encontrado.` });
        
        const davData = davs[0];
        if (davData.cr_tipo != 1) return res.status(400).json({ error: `O DAV ${davNumber} é orçamento.` });

        const combineDateTime = (date, time) => {
            if (!date || (typeof date === 'string' && date.startsWith('0000-00-00'))) return null;
            const dateObject = new Date(date);
            if (isNaN(dateObject.getTime())) return null;
            return new Date(`${dateObject.toISOString().split('T')[0]}T${time || '00:00:00'}`);
        };

        const nfemParts = (davData.cr_nfem || '').split(' ');
        const responseData = {
            dav_numero: davData.cr_ndav,
            data_hora_pedido: combineDateTime(davData.cr_edav, davData.cr_hdav),
            vendedor: davData.cr_udav,
            valor_total: davData.cr_tnot,
            status_caixa: davData.cr_reca,
            filial_pedido_nome: davData.cr_fili,
            filial_pedido_codigo: davData.cr_inde,
            cliente: { nome: davData.cr_nmcl, doc: davData.cl_docume },
            endereco: {
                logradouro: (davData.cr_dade || '').split(';')[0]?.trim(),
                bairro: davData.cr_ebai,
                cidade: davData.cr_ecid,
                cep: davData.cr_ecep,
                referencia: davData.cr_refe
            },
            caixa_info: { usuario: davData.cr_urec, data_hora: combineDateTime(davData.cr_erec, davData.cr_hrec) },
            fiscal_info: { chave: davData.cr_chnf, numero_nf: davData.cr_nota },
            itens: []
        };

        if (davData.cr_reca !== '1') return res.json(responseData);
        
        const historicoQuery = `
            (SELECT e.idavs_regi, e.data_retirada as data, e.quantidade_retirada as quantidade, u.nome_user COLLATE utf8mb4_unicode_ci as responsavel, 'Retirada no Balcão' as tipo
             FROM entregas_manuais_log e JOIN cad_user u ON e.id_usuario_conferencia = u.ID WHERE e.dav_numero = ?)
             UNION ALL
             (SELECT ri.idavs_regi, r.data_criacao as data, ri.quantidade_a_entregar as quantidade, r.nome_motorista COLLATE utf8mb4_unicode_ci as responsavel, 'Saída em Romaneio' as tipo
             FROM romaneio_itens ri JOIN romaneios r ON ri.id_romaneio = r.id WHERE ri.dav_numero = ?)
             ORDER BY data DESC`;

        const allResults = await Promise.all([
            seiPool.execute(`SELECT it_regist, it_ndav, it_item, it_codi, it_nome, it_quan, it_qent, it_qtdv, it_unid, it_entr, it_reti, it_inde FROM idavs WHERE CAST(it_ndav AS UNSIGNED) = ? AND (it_canc IS NULL OR it_canc <> 1)`, [davNumber]),
            gerencialPool.execute('SELECT idavs_regi, SUM(quantidade_retirada) as total FROM entregas_manuais_log WHERE dav_numero = ? GROUP BY idavs_regi', [davNumber]),
            gerencialPool.execute('SELECT idavs_regi, SUM(quantidade_a_entregar) as total FROM romaneio_itens WHERE dav_numero = ? GROUP BY idavs_regi', [davNumber]),
            gerencialPool.execute(historicoQuery, [davNumber, davNumber])
        ]);

        const [itensDav, retiradasManuais, entregasRomaneio, historicoCompleto] = [allResults[0][0], allResults[1][0], allResults[2][0], allResults[3][0]];

        if (itensDav.length === 0) return res.status(404).json({ error: 'Nenhum item válido encontrado.' });
        
        for (const item of itensDav) {
            const idavsRegi = item.it_regist;
            const retManual = retiradasManuais.find(r => r.idavs_regi == idavsRegi);
            const retRomaneio = entregasRomaneio.find(r => r.idavs_regi == idavsRegi);
            
            const { saldo, entregue, devolvido } = calcularSaldosItem(item, retManual, retRomaneio);
            
            responseData.itens.push({
                idavs_regi: idavsRegi,
                pd_codi: item.it_codi,
                pd_nome: item.it_nome,
                unidade: item.it_unid,
                quantidade_total: parseFloat(item.it_quan) || 0,
                quantidade_entregue: entregue,
                quantidade_saldo: saldo,
                quantidade_devolvida: devolvido,
                item_filial_codigo: item.it_inde,
                responsavel_caixa: parseUsuarioLiberacao(item.it_entr),
                historico: historicoCompleto.filter(h => h.idavs_regi == idavsRegi)
            });
        }
        res.json(responseData);

    } catch (error) { res.status(500).json({ error: 'Erro interno no servidor.' }); }
});

router.post('/retirada-manual', authenticateToken, async (req, res) => {
    const { dav_numero: davNumeroStr, itens } = req.body;
    const { userId, nome: nomeUsuario } = req.user;
    const dav_numero = parseInt(davNumeroStr, 10);

    if (isNaN(dav_numero) || !itens || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: 'Dados inválidos.' });
    }

    const gerencialConnection = await gerencialPool.getConnection();
    const seiConnection = await seiPool.getConnection();
    const logsCriados = [];

    try {
        await gerencialConnection.beginTransaction();
        await seiConnection.beginTransaction();

        for (const item of itens) {
            const idavsRegiNum = parseInt(item.idavs_regi, 10);
            const quantidadeRetiradaNum = parseFloat(item.quantidade_retirada);

            const [itemErpRows] = await seiPool.execute(`SELECT * FROM idavs WHERE it_regist = ? FOR UPDATE`, [idavsRegiNum]);
            if(itemErpRows.length === 0) throw new Error(`Item ID: ${idavsRegiNum} não encontrado.`);
            const itemErp = itemErpRows[0];
            
            const [retManuais] = await gerencialPool.execute('SELECT SUM(quantidade_retirada) as total FROM entregas_manuais_log WHERE dav_numero = ? AND idavs_regi = ?', [dav_numero, idavsRegiNum]);
            const [retRomaneio] = await gerencialPool.execute('SELECT SUM(quantidade_a_entregar) as total FROM romaneio_itens WHERE dav_numero = ? AND idavs_regi = ?', [dav_numero, idavsRegiNum]);

            const { saldo } = calcularSaldosItem(itemErp, retManuais[0], retRomaneio[0]);

            if (quantidadeRetiradaNum > saldo) {
                throw new Error(`Saldo insuficiente para ${itemErp.it_nome}. Tentando retirar: ${quantidadeRetiradaNum}.`);
            }

            const [logResult] = await gerencialConnection.execute(
                `INSERT INTO entregas_manuais_log (dav_numero, idavs_regi, quantidade_retirada, id_usuario_conferencia) VALUES (?, ?, ?, ?)`,
                [dav_numero, idavsRegiNum, quantidadeRetiradaNum, userId]
            );
            logsCriados.push(logResult.insertId);
            
            await seiConnection.execute(`UPDATE idavs SET it_qent = it_qent + ? WHERE it_regist = ?`, [quantidadeRetiradaNum, idavsRegiNum]);

            const textoAntigo = itemErp.it_reti || '';
            const now = new Date();
            const dStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
            
            const novoTexto = `Lançamento: ${dStr}  {${nomeUsuario}}\nCodigo....: ${itemErp.it_codi}\nDescrição.: ${itemErp.it_nome}\nQuantidade: ${parseFloat(itemErp.it_quan)}\nUnidade...: ${itemErp.it_unid}\nQT Entrega: ${quantidadeRetiradaNum}\nSaldo.....: Baixa via App Gerencial\nRetirada..: ${quantidadeRetiradaNum}\nLançamento: App Gerencial ID ${logResult.insertId}\nPortador..: App\nRetirado..: Retirada no Balcão via App`;

            await seiConnection.execute(`UPDATE idavs SET it_reti = ? WHERE it_regist = ?`, [textoAntigo ? (textoAntigo + '\n' + novoTexto).trim() : novoTexto.trim(), idavsRegiNum]);
            await gerencialConnection.execute(`UPDATE entregas_manuais_log SET erp_writeback_status = 'Sucesso' WHERE id = ?`, [logResult.insertId]);
        }

        await gerencialConnection.commit();
        await seiConnection.commit();
        res.status(201).json({ message: 'Retirada efetuada com sucesso!' });

    } catch (error) {
        await gerencialConnection.rollback();
        await seiConnection.rollback();
        console.error("Erro na retirada:", error);
        res.status(error.message.includes('Saldo') ? 400 : 500).json({ error: error.message || 'Erro interno.' });
    } finally {
        gerencialConnection.release(); seiConnection.release();
    }
});

// ==========================================================
//               ROTAS DE GESTÃO DE ROMANEIOS
// ==========================================================

router.get('/veiculos-disponiveis', authenticateToken, async (req, res) => {
    try {
        const [veiculos] = await gerencialPool.execute("SELECT id, modelo, placa, capacidade_kg FROM veiculos WHERE status = 'Ativo' ORDER BY modelo ASC");
        res.json(veiculos);
    } catch (error) { res.status(500).json({ error: 'Erro ao buscar veículos.' }); }
});

router.get('/romaneios', authenticateToken, async (req, res) => {
    const { status, filial } = req.query; 
    const { perfil } = req.user; 

    try {
        let query = `SELECT r.id, r.data_criacao, r.nome_motorista, r.filial_origem, r.status, v.modelo as modelo_veiculo, v.placa as placa_veiculo FROM romaneios r JOIN veiculos v ON r.id_veiculo = v.id`;
        const params = [];
        const conditions = [];

        if (status) { conditions.push('r.status = ?'); params.push(status); }

        if (perfil === 'Administrador' || perfil === 'Financeiro') {
            if (filial) { conditions.push('r.filial_origem = ?'); params.push(filial); }
        } else {
            conditions.push('r.filial_origem = ?'); params.push(req.user.unidade); 
        }

        if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY r.data_criacao DESC';

        const [romaneios] = await gerencialPool.execute(query, params);
        res.json(romaneios);
    } catch (error) { res.status(500).json({ error: 'Erro ao buscar romaneios.' }); }
});

router.post('/romaneios', authenticateToken, async (req, res) => {
    const { id_veiculo, nome_motorista } = req.body;
    if (!id_veiculo || !nome_motorista) return res.status(400).json({ error: 'Veículo e motorista obrigatórios.' });
    
    try {
        const [result] = await gerencialPool.execute('INSERT INTO romaneios (id_veiculo, nome_motorista, id_usuario_criacao, filial_origem) VALUES (?, ?, ?, ?)', [id_veiculo, nome_motorista, req.user.userId, req.user.unidade]);
        res.status(201).json({ romaneioId: result.insertId });
    } catch (error) { res.status(500).json({ error: 'Erro interno.' }); }
});

router.delete('/romaneios/:id', authenticateToken, async (req, res) => {
    const romaneioId = parseInt(req.params.id, 10);
    const gerencialConnection = await gerencialPool.getConnection();
    try {
        await gerencialConnection.beginTransaction();
        const [rows] = await gerencialConnection.execute('SELECT status FROM romaneios WHERE id = ? FOR UPDATE', [romaneioId]);
        if (rows.length === 0) throw new Error('Carga não encontrada.');
        if (rows[0].status !== 'Em montagem') throw new Error('Apenas cargas "Em montagem" podem ser excluídas.');

        await gerencialConnection.execute('DELETE FROM romaneio_itens WHERE id_romaneio = ?', [romaneioId]);
        await gerencialConnection.execute('DELETE FROM romaneios WHERE id = ?', [romaneioId]);
        await gerencialConnection.commit();
        res.json({ message: 'Carga excluída.' });
    } catch (error) {
        await gerencialConnection.rollback();
        res.status(400).json({ error: error.message });
    } finally { gerencialConnection.release(); }
});

// ==========================================================
// ROTA EAGER LOADING (Traz DAVs + Itens + Peso + Vendedor + Devolução)
// ==========================================================
router.get('/eligible-davs', authenticateToken, async (req, res) => {
    const { data, tipoData, apenasEntregaMarcada, bairro, cidade, davNumero, filialDav } = req.query;
    const { perfil } = req.user;

    if (!data || !tipoData) return res.status(400).json({ error: "Data obrigatória." });

    try {
        const filialMap = { 'Santa Cruz da Serra': 'LUCAM', 'Piabetá': 'VMNAF', 'Parada Angélica': 'TNASC', 'Nova Campinas': 'LCMAT' };
        const dateColumn = tipoData === 'entrega' ? 'c.cr_entr' : 'c.cr_erec';

        // Correção MATEMÁTICA BRUTA direto no SQL: Comprado - Devolvido - Entregue > 0
        let query = `
            SELECT DISTINCT c.cr_ndav, c.cr_nmcl, c.cr_ebai, c.cr_ecid, c.cr_inde, c.cr_edav, c.cr_entr, c.cr_udav
            FROM cdavs c
            JOIN idavs i ON c.cr_ndav = i.it_ndav
            WHERE c.cr_reca = '1'
              AND DATE(${dateColumn}) = ?
              AND (i.it_quan - i.it_qtdv - i.it_qent) > 0 
        `;
        const params = [data];

        if (apenasEntregaMarcada === 'true') query += ` AND c.cr_entr != '0000-00-00'`; 
        if (bairro) { query += ' AND c.cr_ebai LIKE ?'; params.push(`%${bairro}%`); }
        if (davNumero) { query += ' AND CAST(c.cr_ndav AS UNSIGNED) = ?'; params.push(parseInt(davNumero, 10)); }

        if (perfil === 'Administrador' || perfil === 'Financeiro') {
            if (filialDav) { query += ' AND c.cr_inde = ?'; params.push(filialMap[filialDav]); }
        } else {
            query += ' AND c.cr_inde = ?'; params.push(filialMap[req.user.unidade]);
        }

        query += ' ORDER BY c.cr_ebai, c.cr_nmcl';
        const [davsRaw] = await seiPool.execute(query, params);

        if (davsRaw.length === 0) return res.json([]); 

        const numerosDav = davsRaw.map(d => parseInt(d.cr_ndav, 10));

        const [itensRaw] = await seiPool.query(
            `SELECT i.it_regist, i.it_ndav, i.it_codi, i.it_nome, i.it_unid,
                    i.it_quan, i.it_qent, i.it_qtdv, i.it_inde,
                    COALESCE(NULLIF(p.pd_pesb, 0), NULLIF(p.pd_pesl, 0), 0) as peso_bruto_unitario
             FROM idavs i LEFT JOIN produtos p ON i.it_codi = p.pd_codi
             WHERE i.it_ndav IN (?) AND (i.it_canc IS NULL OR i.it_canc <> 1)`, [numerosDav]
        );

        const [retiradasManuais] = await gerencialPool.query('SELECT idavs_regi, SUM(quantidade_retirada) as total FROM entregas_manuais_log WHERE dav_numero IN (?) GROUP BY idavs_regi', [numerosDav]);
        const [entregasRomaneio] = await gerencialPool.query('SELECT idavs_regi, SUM(quantidade_a_entregar) as total FROM romaneio_itens WHERE dav_numero IN (?) GROUP BY idavs_regi', [numerosDav]);

        const retiradasMap = new Map(retiradasManuais.map(r => [r.idavs_regi, r]));
        const romaneiosMap = new Map(entregasRomaneio.map(r => [r.idavs_regi, r]));

        const davsFormatados = davsRaw.map(dav => {
            const itensDoDav = itensRaw.filter(i => i.it_ndav == dav.cr_ndav);
            const itensComSaldo = [];
            let pesoTotalDav = 0;

            for (const item of itensDoDav) {
                const idavsRegi = item.it_regist;
                const { saldo, entregue, devolvido } = calcularSaldosItem(item, retiradasMap.get(idavsRegi), romaneiosMap.get(idavsRegi));

                if (saldo > 0) {
                    const pesoTotalItem = saldo * parseFloat(item.peso_bruto_unitario);
                    pesoTotalDav += pesoTotalItem;

                    itensComSaldo.push({
                        idavs_regi: idavsRegi, codigo: item.it_codi, nome: item.it_nome, unidade: item.it_unid,
                        saldo: saldo, entregue: entregue, devolvido: devolvido, peso_total_item: pesoTotalItem, filial_item: item.it_inde
                    });
                }
            }

            return {
                dav_numero: dav.cr_ndav, cliente: dav.cr_nmcl, vendedor: dav.cr_udav, 
                bairro: dav.cr_ebai || 'N/I', cidade: dav.cr_ecid || 'N/I', filial: dav.cr_inde,
                data_venda: dav.cr_edav, data_agendada: dav.cr_entr, peso_total_dav: pesoTotalDav, itens: itensComSaldo
            };
        }).filter(dav => dav.itens.length > 0); 

        res.json(davsFormatados);

    } catch (error) { res.status(500).json({ error: 'Erro interno.' }); }
});

router.get('/romaneios/:id', authenticateToken, async (req, res) => {
    const romaneioId = parseInt(req.params.id, 10);
    try {
        const [romaneioDetails] = await gerencialPool.execute(`SELECT r.id, r.data_criacao, r.nome_motorista, r.filial_origem, r.status, v.modelo as modelo_veiculo, v.placa as placa_veiculo, IFNULL(v.capacidade_kg, 0) as capacidade_kg FROM romaneios r JOIN veiculos v ON r.id_veiculo = v.id WHERE r.id = ?`, [romaneioId]);
        if (romaneioDetails.length === 0) return res.status(404).json({ error: 'Romaneio não encontrado.' });

        const [items] = await gerencialPool.execute(`SELECT ri.id as romaneio_item_id, ri.dav_numero, ri.idavs_regi, ri.quantidade_a_entregar, i.it_nome as produto_nome, i.it_unid as produto_unidade, c.cr_nmcl as cliente_nome, COALESCE(NULLIF(p.pd_pesb, 0), NULLIF(p.pd_pesl, 0), 0) as peso_bruto_unitario FROM romaneio_itens ri LEFT JOIN ${dbConfigSei.database}.idavs i ON ri.idavs_regi = i.it_regist LEFT JOIN ${dbConfigSei.database}.cdavs c ON ri.dav_numero = c.cr_ndav LEFT JOIN ${dbConfigSei.database}.produtos p ON i.it_codi = p.pd_codi WHERE ri.id_romaneio = ? ORDER BY ri.dav_numero ASC`, [romaneioId]);
        
        res.json({ ...romaneioDetails[0], itens: items });
    } catch (error) { res.status(500).json({ error: 'Erro interno.' }); }
});

router.post('/romaneios/:id/itens', authenticateToken, async (req, res) => {
    const romaneioId = parseInt(req.params.id, 10);
    const itens = req.body; 
    const gerencialConnection = await gerencialPool.getConnection();
    
    try {
        await gerencialConnection.beginTransaction();
        const [statusRows] = await gerencialConnection.execute('SELECT status FROM romaneios WHERE id = ? FOR UPDATE', [romaneioId]);
        if (statusRows.length === 0 || statusRows[0].status !== 'Em montagem') throw new Error('Romaneio não está em montagem.');

        const idavsArray = [...new Set(itens.map(i => parseInt(i.idavs_regi, 10)))];
        const [itemErpRows] = await seiPool.query(`SELECT it_regist, it_codi, it_nome, it_quan, it_qent, it_qtdv FROM idavs WHERE it_regist IN (?)`, [idavsArray]);
        const itemErpMap = new Map(itemErpRows.map(i => [i.it_regist, i]));

        const [alocadoRows] = await gerencialPool.query('SELECT idavs_regi, SUM(quantidade_a_entregar) as total FROM romaneio_itens WHERE idavs_regi IN (?) AND id_romaneio != ? GROUP BY idavs_regi', [idavsArray, romaneioId]);
        const alocadoMap = new Map(alocadoRows.map(i => [i.idavs_regi, i.total]));

        for (const item of itens) {
            const idavsRegi = parseInt(item.idavs_regi, 10);
            const qtd = parseFloat(item.quantidade_a_entregar);
            const davNumero = parseInt(item.dav_numero, 10);

            const itemErp = itemErpMap.get(idavsRegi);
            const { saldo } = calcularSaldosItem(itemErp, null, { total: alocadoMap.get(idavsRegi) || 0 });

            if (qtd > saldo) throw new Error(`Saldo insuficiente para ${itemErp.it_nome}.`);

            await gerencialConnection.execute(`INSERT INTO romaneio_itens (id_romaneio, dav_numero, idavs_regi, pd_codi, quantidade_a_entregar) VALUES (?, ?, ?, ?, ?)`, [romaneioId, davNumero, idavsRegi, itemErp.it_codi, qtd]);
        }

        await gerencialConnection.commit();
        res.status(201).json({ message: 'Sucesso!' });
    } catch (error) {
        await gerencialConnection.rollback();
        res.status(400).json({ error: error.message });
    } finally { gerencialConnection.release(); }
});

router.delete('/romaneios/:id/itens/:itemId', authenticateToken, async (req, res) => {
    const rId = parseInt(req.params.id, 10);
    const iId = parseInt(req.params.itemId, 10);
    const gc = await gerencialPool.getConnection();
    try {
        await gc.beginTransaction();
        const [status] = await gc.execute('SELECT status FROM romaneios WHERE id = ? FOR UPDATE', [rId]);
        if (status.length === 0 || status[0].status !== 'Em montagem') throw new Error('Não editável.');

        const [del] = await gc.execute('DELETE FROM romaneio_itens WHERE id = ? AND id_romaneio = ?', [iId, rId]);
        if (del.affectedRows === 0) throw new Error('Item não achado.');

        await gc.commit();
        res.json({ message: 'Removido.' });
    } catch (e) { await gc.rollback(); res.status(400).json({ error: e.message }); } finally { gc.release(); }
});

module.exports = router;