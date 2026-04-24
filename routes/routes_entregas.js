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

function calcularSaldosItem(itemErp, retiradaManualDoItem, entregaRomaneioDoItem) {
    const quantidadeComprada = parseFloat(itemErp.it_quan) || 0;
    const totalEntregueErp = parseFloat(itemErp.it_qent) || 0;
    const totalDevolvido = parseFloat(itemErp.it_qtdv) || 0; 

    const quantidadeLiquidaDireito = quantidadeComprada - totalDevolvido;
    const totalEmRomaneioApp = parseFloat(entregaRomaneioDoItem?.total) || 0;
    const totalJaDespachado = totalEntregueErp + totalEmRomaneioApp;
    const saldo = quantidadeLiquidaDireito - totalJaDespachado;

    return {
        saldo: Math.max(0, saldo), 
        entregue: totalJaDespachado,
        devolvido: totalDevolvido 
    };
}

function parseUsuarioLiberacao(it_entr) {
    if (!it_entr || typeof it_entr !== 'string') return 'N/A';
    return it_entr.split(' ').pop() || 'N/A';
}

router.get('/dav/:numero', authenticateToken, async (req, res) => {
    const davNumber = parseInt(req.params.numero, 10);
    const { unidade: filialUsuario } = req.user;

    if (isNaN(davNumber)) return res.status(400).json({ error: 'Número do DAV inválido.' });

    try {
        const filialMap = { 'Santa Cruz da Serra': 'LUCAM', 'Piabetá': 'VMNAF', 'Parada Angélica': 'TNASC', 'Nova Campinas': 'LCMAT' };
        const isUsuarioAdmin = ['escritorio', 'escritório (lojas)'].includes(filialUsuario ? filialUsuario.trim().toLowerCase() : '');

        let davQuery = `
            SELECT c.cr_ndav, c.cr_nmcl, c.cr_dade, c.cr_refe, c.cr_ebai, c.cr_ecid, c.cr_ecep, c.cr_edav, c.cr_hdav, c.cr_udav, c.cr_tnot, c.cr_tipo, c.cr_reca, c.cr_urec, c.cr_erec, c.cr_hrec, c.cr_ecan, c.cr_hcan, c.cr_usac, c.cr_nfem, c.cr_chnf, c.cr_seri, c.cr_tnfs, c.cr_nota, c.cr_fili, c.cr_inde, cl.cl_docume 
            FROM cdavs c LEFT JOIN clientes cl ON c.cr_cdcl = cl.cl_codigo WHERE CAST(c.cr_ndav AS UNSIGNED) = ?
        `;
        const queryParams = [davNumber];

        if (!isUsuarioAdmin) {
            if (!filialMap[filialUsuario]) return res.status(404).json({ error: `Acesso negado para a sua filial.` });
            davQuery += ' AND c.cr_inde = ?';
            queryParams.push(filialMap[filialUsuario]);
        }

        const [davs] = await seiPool.execute(davQuery, queryParams);
        if (davs.length === 0) return res.status(404).json({ error: `Pedido não encontrado.` });
        
        const davData = davs[0];
        if (davData.cr_tipo != 1) return res.status(400).json({ error: `O DAV ${davNumber} é orçamento.` });

        const combineDateTime = (date, time) => {
            if (!date || (typeof date === 'string' && date.startsWith('0000-00-00'))) return null;
            const d = new Date(date);
            return isNaN(d.getTime()) ? null : new Date(`${d.toISOString().split('T')[0]}T${time || '00:00:00'}`);
        };

        const responseData = {
            dav_numero: davData.cr_ndav, data_hora_pedido: combineDateTime(davData.cr_edav, davData.cr_hdav), vendedor: davData.cr_udav, valor_total: davData.cr_tnot, status_caixa: davData.cr_reca, filial_pedido_nome: davData.cr_fili, filial_pedido_codigo: davData.cr_inde,
            cliente: { nome: davData.cr_nmcl, doc: davData.cl_docume },
            endereco: { logradouro: (davData.cr_dade || '').split(';')[0]?.trim(), bairro: davData.cr_ebai, cidade: davData.cr_ecid, cep: davData.cr_ecep, referencia: davData.cr_refe },
            caixa_info: { usuario: davData.cr_urec, data_hora: combineDateTime(davData.cr_erec, davData.cr_hrec) },
            fiscal_info: { chave: davData.cr_chnf, numero_nf: davData.cr_nota },
            itens: []
        };

        if (davData.cr_reca !== '1') return res.json(responseData);
        
        const historicoQuery = `
            (SELECT e.idavs_regi, e.data_retirada as data, e.quantidade_retirada as quantidade, u.nome_user COLLATE utf8mb4_unicode_ci as responsavel, 'Retirada no Balcão' as tipo FROM entregas_manuais_log e JOIN cad_user u ON e.id_usuario_conferencia = u.ID WHERE e.dav_numero = ?)
            UNION ALL
            (SELECT ri.idavs_regi, r.data_criacao as data, ri.quantidade_a_entregar as quantidade, r.nome_motorista COLLATE utf8mb4_unicode_ci as responsavel, 'Saída em Romaneio' as tipo FROM romaneio_itens ri JOIN romaneios r ON ri.id_romaneio = r.id WHERE ri.dav_numero = ?) ORDER BY data DESC`;

        const allResults = await Promise.all([
            seiPool.execute(`SELECT it_regist, it_ndav, it_item, it_codi, it_nome, it_quan, it_qent, it_qtdv, it_unid, it_entr, it_reti, it_inde FROM idavs WHERE CAST(it_ndav AS UNSIGNED) = ? AND (it_canc IS NULL OR it_canc <> 1)`, [davNumber]),
            gerencialPool.execute('SELECT idavs_regi, SUM(quantidade_retirada) as total FROM entregas_manuais_log WHERE dav_numero = ? GROUP BY idavs_regi', [davNumber]),
            gerencialPool.execute('SELECT idavs_regi, SUM(quantidade_a_entregar) as total FROM romaneio_itens WHERE dav_numero = ? GROUP BY idavs_regi', [davNumber]),
            gerencialPool.execute(historicoQuery, [davNumber, davNumber])
        ]);

        const [itensDav, retiradasManuais, entregasRomaneio, historicoCompleto] = [allResults[0][0], allResults[1][0], allResults[2][0], allResults[3][0]];
        if (itensDav.length === 0) return res.status(404).json({ error: 'Nenhum item válido encontrado.' });
        
        for (const item of itensDav) {
            const id = item.it_regist;
            const { saldo, entregue, devolvido } = calcularSaldosItem(item, retiradasManuais.find(r => r.idavs_regi == id), entregasRomaneio.find(r => r.idavs_regi == id));
            
            responseData.itens.push({
                idavs_regi: id, pd_codi: item.it_codi, pd_nome: item.it_nome, unidade: item.it_unid, quantidade_total: parseFloat(item.it_quan) || 0, quantidade_entregue: entregue, quantidade_saldo: saldo, quantidade_devolvida: devolvido, item_filial_codigo: item.it_inde, responsavel_caixa: parseUsuarioLiberacao(item.it_entr), historico: historicoCompleto.filter(h => h.idavs_regi == id)
            });
        }
        res.json(responseData);

    } catch (error) { res.status(500).json({ error: 'Erro interno no servidor.' }); }
});

router.post('/retirada-manual', authenticateToken, async (req, res) => {
    const { dav_numero: davNumeroStr, itens } = req.body;
    const { userId, nome: nomeUsuario } = req.user;
    const dav_numero = parseInt(davNumeroStr, 10);

    if (isNaN(dav_numero) || !itens || !Array.isArray(itens) || itens.length === 0) return res.status(400).json({ error: 'Dados inválidos.' });

    const gc = await gerencialPool.getConnection();
    const sc = await seiPool.getConnection();
    const logsCriados = [];

    try {
        await gc.beginTransaction();
        await sc.beginTransaction();

        for (const item of itens) {
            const idavsRegiNum = parseInt(item.idavs_regi, 10);
            const qtd = parseFloat(item.quantidade_retirada);

            const [itemErpRows] = await sc.execute(`SELECT * FROM idavs WHERE it_regist = ? FOR UPDATE`, [idavsRegiNum]);
            if(itemErpRows.length === 0) throw new Error(`Item ID: ${idavsRegiNum} não encontrado.`);
            const itemErp = itemErpRows[0];
            
            const [retManuais] = await gc.execute('SELECT SUM(quantidade_retirada) as total FROM entregas_manuais_log WHERE dav_numero = ? AND idavs_regi = ?', [dav_numero, idavsRegiNum]);
            const [retRomaneio] = await gc.execute('SELECT SUM(quantidade_a_entregar) as total FROM romaneio_itens WHERE dav_numero = ? AND idavs_regi = ?', [dav_numero, idavsRegiNum]);

            const { saldo } = calcularSaldosItem(itemErp, retManuais[0], retRomaneio[0]);
            if (qtd > saldo) throw new Error(`Saldo insuficiente para ${itemErp.it_nome}.`);

            const [logResult] = await gc.execute(`INSERT INTO entregas_manuais_log (dav_numero, idavs_regi, quantidade_retirada, id_usuario_conferencia) VALUES (?, ?, ?, ?)`, [dav_numero, idavsRegiNum, qtd, userId]);
            logsCriados.push(logResult.insertId);
            
            await sc.execute(`UPDATE idavs SET it_qent = it_qent + ? WHERE it_regist = ?`, [qtd, idavsRegiNum]);

            const textoAntigo = itemErp.it_reti || '';
            const now = new Date();
            const dStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
            
            const novoTexto = `Lançamento: ${dStr}  {${nomeUsuario}}\nCodigo....: ${itemErp.it_codi}\nDescrição.: ${itemErp.it_nome}\nQuantidade: ${parseFloat(itemErp.it_quan)}\nUnidade...: ${itemErp.it_unid}\nQT Entrega: ${qtd}\nSaldo.....: Baixa via App Gerencial\nRetirada..: ${qtd}\nLançamento: App Gerencial ID ${logResult.insertId}\nPortador..: App\nRetirado..: Retirada no Balcão via App [WEB]`;

            await sc.execute(`UPDATE idavs SET it_reti = ? WHERE it_regist = ?`, [textoAntigo ? (textoAntigo + '\n' + novoTexto).trim() : novoTexto.trim(), idavsRegiNum]);
            await gc.execute(`UPDATE entregas_manuais_log SET erp_writeback_status = 'Sucesso' WHERE id = ?`, [logResult.insertId]);
        }

        await gc.commit();
        await sc.commit();
        res.status(201).json({ message: 'Retirada efetuada com sucesso!' });

    } catch (error) {
        await gc.rollback(); await sc.rollback();
        res.status(error.message.includes('Saldo') ? 400 : 500).json({ error: error.message || 'Erro interno.' });
    } finally {
        gc.release(); sc.release();
    }
});

router.get('/motoristas-disponiveis', authenticateToken, async (req, res) => {
    try {
        const [motoristas] = await gerencialPool.execute("SELECT id, nome, cpf FROM cad_motoristas WHERE status = 'Ativo' ORDER BY nome ASC");
        res.json(motoristas);
    } catch (error) { res.status(500).json({ error: 'Erro ao buscar motoristas.' }); }
});

router.get('/veiculos-disponiveis', authenticateToken, async (req, res) => {
    try {
        const [veiculos] = await gerencialPool.execute("SELECT id, modelo, placa, capacidade_kg FROM veiculos WHERE status = 'Ativo' ORDER BY modelo ASC");
        res.json(veiculos);
    } catch (error) { res.status(500).json({ error: 'Erro ao buscar veículos.' }); }
});

router.get('/romaneios', authenticateToken, async (req, res) => {
    const { status, filial, data_inicio, data_fim, motorista, veiculo } = req.query; 
    const { perfil } = req.user; 

    try {
        let query = `SELECT r.id, r.data_criacao, r.data_conclusao, r.nome_motorista, r.filial_origem, r.status, v.modelo as modelo_veiculo, v.placa as placa_veiculo FROM romaneios r JOIN veiculos v ON r.id_veiculo = v.id`;
        const params = [];
        const conditions = [];

        if (status) { 
            const statusArray = status.split(',');
            conditions.push(`r.status IN (${statusArray.map(() => '?').join(',')})`);
            params.push(...statusArray);
        }
        
        if (data_inicio) { conditions.push('DATE(r.data_criacao) >= ?'); params.push(data_inicio); }
        if (data_fim) { conditions.push('DATE(r.data_criacao) <= ?'); params.push(data_fim); }
        if (motorista) { conditions.push('r.nome_motorista LIKE ?'); params.push(`%${motorista}%`); }
        if (veiculo) { conditions.push('r.id_veiculo = ?'); params.push(veiculo); }

        if (perfil === 'Administrador' || perfil === 'Financeiro') {
            if (filial) { conditions.push('r.filial_origem = ?'); params.push(filial); }
        } else {
            conditions.push('r.filial_origem = ?'); params.push(req.user.unidade); 
        }

        if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY r.id DESC';

        const [romaneios] = await gerencialPool.execute(query, params);
        res.json(romaneios);
    } catch (error) { 
        console.error("ERRO NO SELECT DE ROMANEIOS: ", error);
        res.status(500).json({ error: error.message }); 
    }
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
    const gc = await gerencialPool.getConnection();
    const sc = await seiPool.getConnection(); 

    try {
        await gc.beginTransaction();
        await sc.beginTransaction(); 

        const [rows] = await gc.execute('SELECT status FROM romaneios WHERE id = ? FOR UPDATE', [romaneioId]);
        if (rows.length === 0) throw new Error('Carga não encontrada.');
        if (rows[0].status !== 'Em montagem') throw new Error('Apenas cargas "Em montagem" podem ser excluídas.');

        const [itensNaCarga] = await gc.execute('SELECT dav_numero, idavs_regi FROM romaneio_itens WHERE id_romaneio = ?', [romaneioId]);
        
        for (const item of itensNaCarga) {
            await sc.execute("UPDATE cdavs SET cr_roma='', cr_dado='' WHERE cr_ndav=?", [item.dav_numero.toString().padStart(13, '0')]);
            await sc.execute("UPDATE idavs SET it_logi='0' WHERE it_regist=?", [item.idavs_regi]);
        }

        await gc.execute('DELETE FROM romaneio_itens WHERE id_romaneio = ?', [romaneioId]);
        await gc.execute('DELETE FROM romaneios WHERE id = ?', [romaneioId]);

        await gc.commit();
        await sc.commit();
        res.json({ message: 'Carga excluída e removida do ERP com sucesso!' });

    } catch (error) {
        await gc.rollback();
        if(sc) await sc.rollback();
        res.status(400).json({ error: error.message });
    } finally { 
        gc.release(); 
        if(sc) sc.release(); 
    }
});

router.post('/romaneios/:id/fechar', authenticateToken, async (req, res) => {
    const romaneioId = parseInt(req.params.id, 10);
    const { itens_acerto } = req.body; 
    const { nome: nomeUsuario } = req.user;

    const gc = await gerencialPool.getConnection();
    const sc = await seiPool.getConnection();

    try {
        await gc.beginTransaction();
        await sc.beginTransaction();

        const [statusRows] = await gc.execute('SELECT status FROM romaneios WHERE id = ? FOR UPDATE', [romaneioId]);
        if (statusRows.length === 0 || statusRows[0].status === 'Concluido') {
            throw new Error('Romaneio não encontrado ou já está Concluído.');
        }

        const now = new Date();
        const dStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

        for (const item of itens_acerto) {
            const idavs_regi = parseInt(item.idavs_regi, 10);
            const qtd_entregue = parseFloat(item.qtd_entregue) || 0;
            const qtd_voltou = parseFloat(item.qtd_voltou) || 0; 

            const [itemErpRows] = await sc.execute(`SELECT * FROM idavs WHERE it_regist = ? FOR UPDATE`, [idavs_regi]);
            if (itemErpRows.length === 0) continue;
            const itemErp = itemErpRows[0];

            if (qtd_entregue > 0) {
                await sc.execute(`UPDATE idavs SET it_qent = it_qent + ? WHERE it_regist = ?`, [qtd_entregue, idavs_regi]);
                const textoAntigo = itemErp.it_reti || '';
                
                const novoTexto = `Lançamento: ${dStr}  {${nomeUsuario}}\nCodigo....: ${itemErp.it_codi}\nDescrição.: ${itemErp.it_nome}\nQuantidade: ${parseFloat(itemErp.it_quan)}\nUnidade...: ${itemErp.it_unid}\nQT Entrega: ${qtd_entregue}\nSaldo.....: Entrega de Romaneio #${romaneioId}\nRetirada..: ${qtd_entregue}\nLançamento: App Gerencial [WEB]\nPortador..: Motorista\nRetirado..: Entrega Total via Romaneio`;
                
                await sc.execute(`UPDATE idavs SET it_reti = ? WHERE it_regist = ?`, [textoAntigo ? (textoAntigo + '\n' + novoTexto).trim() : novoTexto.trim(), idavs_regi]);
            }

            if (qtd_voltou > 0) {
                const [itemErpRowsAtualizado] = await sc.execute(`SELECT it_reti FROM idavs WHERE it_regist = ?`, [idavs_regi]);
                const textoAntigoDev = itemErpRowsAtualizado[0].it_reti || '';
                
                const novoTextoDev = `Lançamento: ${dStr}  {${nomeUsuario}}\nCodigo....: ${itemErp.it_codi}\nDescrição.: ${itemErp.it_nome}\nQuantidade: ${parseFloat(itemErp.it_quan)}\nUnidade...: ${itemErp.it_unid}\nQT Entrega: ${qtd_entregue}\nSaldo.....: Voltou p/ Loja\nRetirada..: 0\nLançamento: App Gerencial [WEB]\nPortador..: Romaneio #${romaneioId} (Motorista)\nRetirado..: Entregue: ${qtd_entregue} | Voltou: ${qtd_voltou}`;
                
                await sc.execute(`UPDATE idavs SET it_reti = ? WHERE it_regist = ?`, [textoAntigoDev ? (textoAntigoDev + '\n' + novoTextoDev).trim() : novoTextoDev.trim(), idavs_regi]);
            }

            await sc.execute("UPDATE idavs SET it_logi='0' WHERE it_regist=?", [idavs_regi]);
        }

        const [davsUnicos] = await gc.execute('SELECT DISTINCT dav_numero FROM romaneio_itens WHERE id_romaneio = ?', [romaneioId]);
        for (const row of davsUnicos) {
            const davStr = row.dav_numero.toString().padStart(13, '0');
            await sc.execute("UPDATE cdavs SET cr_roma='', cr_dado='' WHERE cr_ndav=?", [davStr]);
        }

        await gc.execute(`UPDATE romaneios SET status = 'Concluido', data_conclusao = NOW() WHERE id = ?`, [romaneioId]);

        await gc.commit();
        await sc.commit();
        res.json({ message: 'Romaneio fechado e baixado no ERP com sucesso!' });

    } catch (error) {
        await gc.rollback();
        if (sc) await sc.rollback();
        res.status(400).json({ error: error.message });
    } finally {
        gc.release();
        if (sc) sc.release();
    }
});

router.get('/eligible-davs', authenticateToken, async (req, res) => {
    const { data, tipoData, apenasEntregaMarcada, bairro, apenasReceberLocal, filialDav } = req.query;
    const { perfil } = req.user;

    if (!data || !tipoData) return res.status(400).json({ error: "Data obrigatória." });

    try {
        const filialMap = { 'Santa Cruz da Serra': 'LUCAM', 'Piabetá': 'VMNAF', 'Parada Angélica': 'TNASC', 'Nova Campinas': 'LCMAT' };
        const dateColumn = tipoData === 'entrega' ? 'c.cr_entr' : 'c.cr_erec';

        let query = `
            SELECT DISTINCT c.cr_ndav, c.cr_nmcl, c.cr_ebai, c.cr_ecid, c.cr_inde, c.cr_edav, c.cr_entr, c.cr_udav, c.cr_reca, c.cr_rloc, c.cr_nota, c.cr_chnf
            FROM cdavs c JOIN idavs i ON c.cr_ndav = i.it_ndav
            WHERE DATE(${dateColumn}) = ? AND (i.it_quan - i.it_qtdv - i.it_qent) > 0 AND c.cr_roma = '' 
        `;
        const params = [data];

        if (apenasReceberLocal === 'true') {
            query += ` AND c.cr_reca != '1' AND c.cr_rloc IN ('1','S','T')`;
        } else {
            query += ` AND c.cr_reca = '1'`;
        }

        if (apenasEntregaMarcada === 'true') query += ` AND c.cr_entr != '0000-00-00'`; 
        if (bairro) { query += ' AND c.cr_ebai LIKE ?'; params.push(`%${bairro}%`); }

        // AJUSTE: Permite múltiplas filiais (Array IN)
        if (perfil === 'Administrador' || perfil === 'Financeiro') {
            if (filialDav) { 
                const filiaisArr = filialDav.split(',').map(f => filialMap[f.trim()]).filter(Boolean);
                if (filiaisArr.length > 0) {
                    query += ` AND c.cr_inde IN (${filiaisArr.map(() => '?').join(',')})`;
                    params.push(...filiaisArr);
                }
            }
        } else {
            query += ' AND c.cr_inde = ?'; params.push(filialMap[req.user.unidade]);
        }

        query += ' ORDER BY c.cr_ebai, c.cr_nmcl';
        const [davsRaw] = await seiPool.execute(query, params);

        if (davsRaw.length === 0) return res.json([]); 

        const numerosDav = davsRaw.map(d => parseInt(d.cr_ndav, 10));

        const [itensRaw] = await seiPool.query(
            `SELECT i.it_regist, i.it_ndav, i.it_codi, i.it_nome, i.it_unid, i.it_quan, i.it_qent, i.it_qtdv, i.it_inde, COALESCE(NULLIF(p.pd_pesb, 0), NULLIF(p.pd_pesl, 0), 0) as peso_bruto_unitario
             FROM idavs i LEFT JOIN produtos p ON i.it_codi = p.pd_codi WHERE i.it_ndav IN (?) AND (i.it_canc IS NULL OR i.it_canc <> 1)`, [numerosDav]
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
                        saldo: saldo, entregue: entregue, devolvido: devolvido, peso_unitario: item.peso_bruto_unitario, peso_total_item: pesoTotalItem, filial_item: item.it_inde
                    });
                }
            }

            return {
                dav_numero: dav.cr_ndav, cliente: dav.cr_nmcl, vendedor: dav.cr_udav, bairro: dav.cr_ebai || 'N/I', cidade: dav.cr_ecid || 'N/I', filial: dav.cr_inde, data_venda: dav.cr_edav, data_agendada: dav.cr_entr, peso_total_dav: pesoTotalDav, 
                status_caixa: dav.cr_reca, cobrar_local: dav.cr_rloc, nota_fiscal: dav.cr_nota, chave_nfe: dav.cr_chnf,
                itens: itensComSaldo
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

        const [items] = await gerencialPool.execute(`SELECT ri.id as romaneio_item_id, ri.dav_numero, ri.idavs_regi, ri.quantidade_a_entregar, ri.pd_codi as produto_codigo, ri.pd_nome as produto_nome, i.it_unid as produto_unidade, c.cr_nmcl as cliente_nome, COALESCE(NULLIF(p.pd_pesb, 0), NULLIF(p.pd_pesl, 0), 0) as peso_bruto_unitario FROM romaneio_itens ri LEFT JOIN ${dbConfigSei.database}.idavs i ON ri.idavs_regi = i.it_regist LEFT JOIN ${dbConfigSei.database}.cdavs c ON ri.dav_numero = c.cr_ndav LEFT JOIN ${dbConfigSei.database}.produtos p ON ri.pd_codi = p.pd_codi WHERE ri.id_romaneio = ? ORDER BY ri.dav_numero ASC`, [romaneioId]);
        
        res.json({ ...romaneioDetails[0], itens: items });
    } catch (error) { res.status(500).json({ error: 'Erro interno.' }); }
});

router.post('/romaneios/:id/itens', authenticateToken, async (req, res) => {
    const romaneioId = parseInt(req.params.id, 10);
    const itens = req.body; 
    const { nome: nomeUsuario } = req.user;

    const gc = await gerencialPool.getConnection();
    const sc = await seiPool.getConnection(); 
    
    try {
        await gc.beginTransaction();
        await sc.beginTransaction(); 

        const [statusRows] = await gc.execute('SELECT status FROM romaneios WHERE id = ? FOR UPDATE', [romaneioId]);
        if (statusRows.length === 0 || statusRows[0].status !== 'Em montagem') throw new Error('Romaneio não está em montagem.');

        const idavsArray = [...new Set(itens.map(i => parseInt(i.idavs_regi, 10)))];
        const [itemErpRows] = await sc.query(`SELECT it_regist, it_codi, it_nome, it_quan, it_qent, it_qtdv FROM idavs WHERE it_regist IN (?)`, [idavsArray]);
        const itemErpMap = new Map(itemErpRows.map(i => [i.it_regist, i]));

        const [alocadoRows] = await gc.query('SELECT idavs_regi, SUM(quantidade_a_entregar) as total FROM romaneio_itens WHERE idavs_regi IN (?) AND id_romaneio != ? GROUP BY idavs_regi', [idavsArray, romaneioId]);
        const alocadoMap = new Map(alocadoRows.map(i => [i.idavs_regi, i.total]));

        const now = new Date();
        const strDate = `1 ${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')} ${nomeUsuario} [WEB]`;

        for (const item of itens) {
            const idavsRegi = parseInt(item.idavs_regi, 10);
            const qtd = parseFloat(item.quantidade_a_entregar);
            const davNumeroStr = item.dav_numero.toString().padStart(13, '0'); 

            const itemErp = itemErpMap.get(idavsRegi);
            if(!itemErp) throw new Error(`Item ${idavsRegi} não encontrado no ERP.`);

            const { saldo } = calcularSaldosItem(itemErp, null, { total: alocadoMap.get(idavsRegi) || 0 });

            if (qtd > saldo) throw new Error(`Saldo insuficiente para ${itemErp.it_nome}.`);

            await gc.execute(
                `INSERT INTO romaneio_itens (id_romaneio, dav_numero, idavs_regi, pd_codi, pd_nome, quantidade_a_entregar) VALUES (?, ?, ?, ?, ?, ?)`, 
                [romaneioId, item.dav_numero, idavsRegi, itemErp.it_codi, itemErp.it_nome, qtd]
            );
            
            await sc.execute(`UPDATE cdavs SET cr_roma=?, cr_dado=? WHERE cr_ndav=?`, [romaneioId.toString(), strDate, davNumeroStr]);
            await sc.execute(`UPDATE idavs SET it_logi=? WHERE it_regist=?`, [qtd.toString(), idavsRegi]);
        }

        await gc.commit();
        await sc.commit();
        res.status(201).json({ message: 'Sucesso!' });
    } catch (error) {
        await gc.rollback();
        if (sc) await sc.rollback();
        res.status(400).json({ error: error.message });
    } finally { 
        gc.release(); 
        if (sc) sc.release(); 
    }
});

router.delete('/romaneios/:id/itens/:itemId', authenticateToken, async (req, res) => {
    const rId = parseInt(req.params.id, 10);
    const iId = parseInt(req.params.itemId, 10);
    
    const gc = await gerencialPool.getConnection();
    const sc = await seiPool.getConnection();

    try {
        await gc.beginTransaction();
        await sc.beginTransaction();

        const [status] = await gc.execute('SELECT status FROM romaneios WHERE id = ? FOR UPDATE', [rId]);
        if (status.length === 0 || status[0].status !== 'Em montagem') throw new Error('Não editável.');

        const [itemData] = await gc.execute('SELECT dav_numero, idavs_regi FROM romaneio_itens WHERE id = ?', [iId]);
        if (itemData.length === 0) throw new Error('Item não achado.');

        const davNum = itemData[0].dav_numero.toString().padStart(13, '0');
        const idavsReg = itemData[0].idavs_regi;

        const [outrosItens] = await gc.execute('SELECT count(*) as qtd FROM romaneio_itens WHERE id_romaneio = ? AND dav_numero = ? AND id != ?', [rId, itemData[0].dav_numero, iId]);
        
        if (outrosItens[0].qtd === 0) {
             await sc.execute("UPDATE cdavs SET cr_roma='', cr_dado='' WHERE cr_ndav=?", [davNum]);
        }
        await sc.execute("UPDATE idavs SET it_logi='0' WHERE it_regist=?", [idavsReg]);

        const [del] = await gc.execute('DELETE FROM romaneio_itens WHERE id = ? AND id_romaneio = ?', [iId, rId]);
        
        await gc.commit();
        await sc.commit();
        res.json({ message: 'Removido.' });
    } catch (e) { 
        await gc.rollback(); 
        if(sc) await sc.rollback();
        res.status(400).json({ error: e.message }); 
    } finally { 
        gc.release(); 
        if(sc) sc.release();
    }
});

const { gerarPDF } = require('@alexssmusica/node-pdf-nfe');

router.get('/danfe/:chave', authenticateToken, async (req, res) => {
    const chave = req.params.chave;
    
    try {
        const [xmlRows] = await seiPool.execute(
            `SELECT sf_xmlarq, sf_arqxml FROM sefazxml WHERE sf_nchave = ? LIMIT 1`, 
            [chave]
        );

        if (xmlRows.length === 0) return res.status(404).json({ error: 'XML da Nota não encontrado.' });

        const [notaRows] = await seiPool.execute(
            `SELECT cr_nota, cr_inde FROM cdavs WHERE cr_chnf = ? LIMIT 1`,
            [chave]
        );
        
        let numNota = chave.substring(25, 34); 
        let unidade = 'Loja';
        
        if (notaRows.length > 0) {
            numNota = notaRows[0].cr_nota || numNota;
            unidade = notaRows[0].cr_inde || unidade;
        }

        numNota = parseInt(numNota, 10).toString();

        let xmlContent = xmlRows[0].sf_xmlarq || xmlRows[0].sf_arqxml;
        if (!xmlContent) return res.status(404).json({ error: 'Conteúdo do XML está vazio.' });
        if (Buffer.isBuffer(xmlContent)) xmlContent = xmlContent.toString('utf8');

        const doc = await gerarPDF(xmlContent);
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
        res.setHeader('Content-Disposition', `attachment; filename="NFe_${numNota}_${unidade}.pdf"`);
        
        doc.pipe(res);

    } catch (error) {
        console.error("Erro ao gerar DANFE:", error);
        res.status(500).json({ error: 'Erro interno ao gerar o PDF da Nota Fiscal.' });
    }
});

module.exports = router;