const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken } = require('../middlewares');
const dbConfig = require('../dbConfig'); // Conexão com gerencial_lucamat

// Configuração de conexão para o banco de dados do ERP (SEI)
const dbConfigSei = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE_SEI,
    charset: 'utf8mb4'
};

// --- Pools de Conexão ---
const seiPool = mysql.createPool(dbConfigSei);
const gerencialPool = mysql.createPool(dbConfig);


// ==========================================================
//               FUNÇÕES AUXILIARES
// ==========================================================

function parseUsuarioLiberacao(it_entr) {
    if (!it_entr || typeof it_entr !== 'string') {
        return 'N/A';
    }
    const parts = it_entr.split(' ');
    return parts[parts.length - 1] || 'N/A';
}

function parseRetiradasAnteriores(it_reti) {
    if (!it_reti || typeof it_reti !== 'string') {
        return 0;
    }
    let totalRetirado = 0;
    const regex = /Retirada\.\.:\s*(\d+[\.,]?\d*)/g;
    let match;
    while ((match = regex.exec(it_reti)) !== null) {
        totalRetirado += parseFloat(match[1].replace(',', '.'));
    }
    return totalRetirado;
}

/**
 * FUNÇÃO DE CÁLCULO DE SALDO - VERSÃO FINAL CORRETA
 * Calcula o saldo disponível de um item.
 */
function calcularSaldosItem(itemErp, retiradaManualDoItem, entregaRomaneioDoItem) {
    const quantidadeTotalPedido = parseFloat(itemErp.it_quan) || 0;
    const totalEntregueBruto = parseFloat(itemErp.it_qent) || 0; // Total que já saiu
    const totalDevolvido = parseFloat(itemErp.it_qtdv) || 0;    // Total que já voltou

    // 1. Calcula o que está efetivamente com o cliente (Entregue Líquido).
    // Fórmula: (Total que Saiu) - (Total que Voltou)
    const entregueLiquido = totalEntregueBruto - totalDevolvido;

    // 2. Soma qualquer quantidade que esteja alocada em *outros* romaneios no nosso app.
    const totalEmRomaneioApp = parseFloat(entregaRomaneioDoItem?.total) || 0;
    
    // 3. Soma retiradas manuais do nosso app (caso não reflitam em it_qent imediatamente)
    // NOTA: Esta lógica assume que 'retiradaManualDoItem' vem de um 'GROUP BY' do log de retiradas manuais.
    const totalRetiradaManualApp = parseFloat(retiradaManualDoItem?.total) || 0;

    // 4. O total indisponível é a soma do que está com o cliente + o que está em rota + o que foi retirado manualmente.
    // Se a retirada manual JÁ atualiza o it_qent, o totalRetiradaManualApp deve ser removido da soma
    // Vamos manter a lógica original que soma os três, pois 'calcularSaldosItem' é usado tanto na leitura
    // (onde 'it_qent' está atualizado) quanto na validação de retirada (onde 'it_qent' ainda não foi atualizado).
    
    // CORREÇÃO DA LÓGICA DE SALDO:
    // Saldo = Total do Pedido - (O que já saiu e não voltou) - (O que está alocado em outros romaneios)
    // O 'totalRetiradaManualApp' é problemático aqui se 'it_qent' já o inclui.
    // A lógica mais segura para SALDO é:
    // Saldo = Total Pedido - (Entregue Líquido no ERP) - (Alocado em Romaneios)
    const totalIndisponivel = entregueLiquido + totalEmRomaneioApp;
    
    const saldo = quantidadeTotalPedido - totalIndisponivel;

    return {
        saldo: Math.max(0, saldo), 
        // 'entregue' reflete o que já saiu (líquido) + o que está em rota
        entregue: Math.max(0, totalIndisponivel) 
    };
}

// ==========================================================
//               ROTAS DE RETIRADA RÁPIDA (BALCÃO)
// ==========================================================

/**
 * Rota GET /dav/:numero
 * Busca dados de um DAV, aplicando filtro de filial e incluindo 'it_inde' nos itens.
 */
router.get('/dav/:numero', authenticateToken, async (req, res) => {
    const davNumberStr = req.params.numero;
    const davNumber = parseInt(davNumberStr, 10);
    const { unidade: filialUsuario } = req.user;

    if (isNaN(davNumber)) {
        return res.status(400).json({ error: 'Número do DAV inválido.' });
    }
    console.log(`[LOG] Iniciando busca para DAV: ${davNumber} pelo usuário da filial: ${filialUsuario}`);

    try {
        const filialMap = {
            'Santa Cruz da Serra': 'LUCAM',
            'Piabetá': 'VMNAF',
            'Parada Angélica': 'TNASC',
            'Nova Campinas': 'LCMAT'
            // Adicione outras filiais aqui (Nome no Token -> Código no cr_inde)
        };

        const adminFiliais = ['escritorio', 'escritório (lojas)'];
        const filialUsuarioNormalizada = filialUsuario ? filialUsuario.trim().toLowerCase() : '';
        const needsFilialFilter = !adminFiliais.includes(filialUsuarioNormalizada);

        // 1. Busca dados do cabeçalho do DAV (cdavs)
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
            if (!filialCode) {
                console.warn(`[SECURITY] Usuário da filial "${filialUsuario}" (não mapeada) tentou acesso. Acesso negado.`);
                return res.status(404).json({ error: `Pedido (DAV) com número ${davNumber} não encontrado ou acesso não permitido para sua filial.` });
            }
            davQuery += ' AND c.cr_inde = ?';
            queryParams.push(filialCode);
        } else {
             console.log(`[LOG] Usuário da filial "${filialUsuario}" tem acesso irrestrito.`);
        }

        console.log('[LOG] Passo 1: Buscando dados do DAV (cdavs)...');
        const [davs] = await seiPool.execute(davQuery, queryParams);

        if (davs.length === 0) {
            return res.status(404).json({ error: `Pedido (DAV) com número ${davNumber} não encontrado` + (needsFilialFilter ? ` para sua filial.` : '.') });
        }
        const davData = davs[0];

        // Verificação de Orçamento
        if (davData.cr_tipo != 1) {
            return res.status(400).json({ error: `O DAV ${davNumber} é um orçamento e não pode ser faturado.` });
        }

        const combineDateTime = (date, time) => {
            if (!date || (typeof date === 'string' && date.startsWith('0000-00-00'))) return null;
            const dateObject = new Date(date);
            if (isNaN(dateObject.getTime())) return null;
            const validTime = time || '00:00:00';
            const datePart = dateObject.toISOString().split('T')[0];
            return new Date(`${datePart}T${validTime}`);
        };

        // 2. Monta o objeto de resposta principal
        const nfemParts = (davData.cr_nfem || '').split(' ');
        const fiscalInfo = {
            data_emissao: nfemParts[0] && nfemParts[1] ? combineDateTime(nfemParts[0], nfemParts[1]) : null,
            protocolo: nfemParts[2] || null,
            usuario: nfemParts[3] || null,
            chave: davData.cr_chnf,
            serie: davData.cr_seri,
            tipo: davData.cr_tnfs,
            numero_nf: davData.cr_nota
        };
        const cancelamentoInfo = {
            data_hora: combineDateTime(davData.cr_ecan, davData.cr_hcan),
            usuario: davData.cr_usac
        };

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
            caixa_info: {
                usuario: davData.cr_urec,
                data_hora: combineDateTime(davData.cr_erec, davData.cr_hrec)
            },
            fiscal_info: fiscalInfo,
            cancelamento_info: cancelamentoInfo,
            itens: []
        };

        // 3. Se o pedido não estiver "Recebido", não busca itens
        if (davData.cr_reca !== '1') {
            console.log(`[LOG] Pedido ${davNumber} com status '${davData.cr_reca}'. Não buscará itens.`);
            return res.json(responseData);
        }
        
        console.log(`[LOG] Pedido ${davNumber} recebido. Buscando itens (idavs)...`);
        
        const historicoQuery = `
            (SELECT e.idavs_regi, e.data_retirada as data, e.quantidade_retirada as quantidade, u.nome_user COLLATE utf8mb4_unicode_ci as responsavel, 'Retirada no Balcão' as tipo
             FROM entregas_manuais_log e 
             JOIN cad_user u ON e.id_usuario_conferencia = u.ID 
             WHERE e.dav_numero = ?)
             UNION ALL
             (SELECT ri.idavs_regi, r.data_criacao as data, ri.quantidade_a_entregar as quantidade, r.nome_motorista COLLATE utf8mb4_unicode_ci as responsavel, 'Saída em Romaneio' as tipo
             FROM romaneio_itens ri 
             JOIN romaneios r ON ri.id_romaneio = r.id 
             WHERE ri.dav_numero = ?)
             ORDER BY data DESC`;

        // 4. Busca dados dos itens e históricos
        const allResults = await Promise.all([
            seiPool.execute(
                `SELECT it_regist, it_ndav, it_item, it_codi, it_nome, it_quan, it_qent, it_qtdv, it_unid, it_entr, it_reti, it_inde 
                 FROM idavs 
                 WHERE CAST(it_ndav AS UNSIGNED) = ? AND (it_canc IS NULL OR it_canc <> 1)`,
                [davNumber]
            ),
            gerencialPool.execute('SELECT idavs_regi, SUM(quantidade_retirada) as total FROM entregas_manuais_log WHERE dav_numero = ? GROUP BY idavs_regi', [davNumber]),
            gerencialPool.execute('SELECT idavs_regi, SUM(quantidade_a_entregar) as total FROM romaneio_itens WHERE dav_numero = ? GROUP BY idavs_regi', [davNumber]),
            gerencialPool.execute(historicoQuery, [davNumber, davNumber])
        ]);

        const [itensDav, retiradasManuais, entregasRomaneio, historicoCompleto] = [allResults[0][0], allResults[1][0], allResults[2][0], allResults[3][0]];

        if (itensDav.length === 0) {
            return res.status(404).json({ error: 'Nenhum item válido encontrado para este pedido.' });
        }
        
        // 5. Processa cada item e calcula saldos
        const itensComSaldo = [];
        for (const item of itensDav) {
            const idavsRegi = item.it_regist;
            const retiradaManualDoItem = retiradasManuais.find(r => r.idavs_regi == idavsRegi);
            const entregaRomaneioDoItem = entregasRomaneio.find(r => r.idavs_regi == idavsRegi);
            const { saldo, entregue } = calcularSaldosItem(item, retiradaManualDoItem, entregaRomaneioDoItem);
            const historicoDoItem = historicoCompleto.filter(h => h.idavs_regi == idavsRegi);

            itensComSaldo.push({
                idavs_regi: idavsRegi,
                pd_codi: item.it_codi,
                pd_nome: item.it_nome,
                unidade: item.it_unid,
                quantidade_total: parseFloat(item.it_quan) || 0,
                quantidade_entregue: entregue,
                quantidade_saldo: saldo,
                quantidade_devolvida: parseFloat(item.it_qtdv) || 0,
                quantidade_entregue_bruta: parseFloat(item.it_qent) || 0,
                item_filial_codigo: item.it_inde, // <-- Campo da filial do item
                responsavel_caixa: parseUsuarioLiberacao(item.it_entr),
                historico: historicoDoItem
            });
        }
        
        responseData.itens = itensComSaldo;
        console.log(`[LOG] Processamento do DAV ${davNumber} concluído com sucesso.`);
        res.json(responseData);

    } catch (error) {
        console.error(`\n--- [ERRO FATAL] ---`);
        console.error(`Falha crítica ao processar a rota /dav/${davNumber}`);
        console.error(`Mensagem: ${error.message}`);
        console.error(`Stack Trace:`, error);
        console.error(`--- [FIM DO ERRO] ---\n`);
        res.status(500).json({ error: 'Erro interno no servidor ao processar o pedido.' });
    }
});


router.post('/retirada-manual', authenticateToken, async (req, res) => {
    const { dav_numero: davNumeroStr, itens } = req.body;
    const { userId, nome: nomeUsuario } = req.user;
    const dav_numero = parseInt(davNumeroStr, 10);

    if (isNaN(dav_numero) || !itens || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: 'Dados inválidos para registrar a retirada.' });
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

            if (isNaN(idavsRegiNum) || isNaN(quantidadeRetiradaNum) || quantidadeRetiradaNum <= 0) {
                throw new Error(`Dados inválidos para o item ${item.pd_nome}.`);
            }

            const [itemErpParaSaldoRows] = await seiPool.execute(`SELECT * FROM idavs WHERE it_regist = ? FOR UPDATE`, [idavsRegiNum]);
            if(itemErpParaSaldoRows.length === 0) {
                throw new Error(`Item ${item.pd_nome} (ID: ${idavsRegiNum}) não encontrado no ERP.`);
            }
            const itemErpParaSaldo = itemErpParaSaldoRows[0];
            
            const [retiradaManualParaSaldo] = await gerencialPool.execute('SELECT SUM(quantidade_retirada) as total FROM entregas_manuais_log WHERE dav_numero = ? AND idavs_regi = ?', [dav_numero, idavsRegiNum]);
            const [entregaRomaneioParaSaldo] = await gerencialPool.execute('SELECT SUM(quantidade_a_entregar) as total FROM romaneio_itens WHERE dav_numero = ? AND idavs_regi = ?', [dav_numero, idavsRegiNum]);

            const { saldo } = calcularSaldosItem(
                itemErpParaSaldo,
                retiradaManualParaSaldo[0],
                entregaRomaneioParaSaldo[0]
            );

            if (quantidadeRetiradaNum > saldo) {
                throw new Error(`Saldo insuficiente para o item ${itemErpParaSaldo.it_nome}. Saldo disponível: ${saldo}, Tentando retirar: ${quantidadeRetiradaNum}.`);
            }

            const [logResult] = await gerencialConnection.execute(
                `INSERT INTO entregas_manuais_log (dav_numero, idavs_regi, quantidade_retirada, id_usuario_conferencia) VALUES (?, ?, ?, ?)`,
                [dav_numero, idavsRegiNum, quantidadeRetiradaNum, userId]
            );
            const newLogId = logResult.insertId;
            logsCriados.push(newLogId);
            
            await seiConnection.execute(
                `UPDATE idavs SET it_qent = it_qent + ? WHERE it_regist = ?`,
                [quantidadeRetiradaNum, idavsRegiNum]
            );

            const [itemErpRows] = await seiConnection.execute(
                `SELECT it_reti, it_codi, it_nome, it_unid, it_quan FROM idavs WHERE it_regist = ?`,
                [idavsRegiNum]
            );
            
            const itemErp = itemErpRows[0];
            const textoAntigo = itemErp.it_reti || '';
            const now = new Date();
            const dataHoraERP = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
            
            const novoTexto = `Lançamento: ${dataHoraERP}  {${nomeUsuario}}
Codigo....: ${itemErp.it_codi}
Descrição.: ${itemErp.it_nome}
Quantidade: ${parseFloat(itemErp.it_quan)}
Unidade...: ${itemErp.it_unid}
QT Entrega: ${quantidadeRetiradaNum}
Saldo.....: Baixa via App Gerencial
Retirada..: ${quantidadeRetiradaNum}
Lançamento: App Gerencial ID ${newLogId}
Portador..: App
Retirado..: Retirada no Balcão via App`;

            const textoFinal = textoAntigo ? (textoAntigo + '\n' + novoTexto).trim() : novoTexto.trim();

            await seiConnection.execute(
                `UPDATE idavs SET it_reti = ? WHERE it_regist = ?`,
                [textoFinal, idavsRegiNum]
            );

            await gerencialConnection.execute(
                `UPDATE entregas_manuais_log SET erp_writeback_status = 'Sucesso' WHERE id = ?`,
                [newLogId]
            );
        }

        await gerencialConnection.commit();
        await seiConnection.commit();

        res.status(201).json({ message: 'Retirada registrada e atualizada no ERP com sucesso!' });

    } catch (error) {
        await gerencialConnection.rollback();
        await seiConnection.rollback();
        
        if (logsCriados.length > 0) {
            const updatePromises = logsCriados.map(logId => 
                gerencialPool.execute(`UPDATE entregas_manuais_log SET erp_writeback_status = 'Falha' WHERE id = ?`, [logId])
            );
            await Promise.all(updatePromises);
        }

        console.error("Erro ao registrar retirada manual:", error);
        res.status(error.message.includes('Saldo insuficiente') ? 400 : 500).json({ error: error.message || 'Erro interno ao salvar a retirada.' });
    } finally {
        gerencialConnection.release();
        seiConnection.release();
    }
});

// ==========================================================
//               ROTAS DE GESTÃO DE ROMANEIOS
// ==========================================================

router.get('/veiculos-disponiveis', authenticateToken, async (req, res) => {
    try {
        const [veiculos] = await gerencialPool.execute(
            "SELECT id, modelo, placa FROM veiculos WHERE status = 'Ativo' ORDER BY modelo ASC"
        );
        res.json(veiculos);
    } catch (error) {
        console.error("Erro ao buscar veículos disponíveis:", error);
        res.status(500).json({ error: 'Erro ao buscar veículos.' });
    }
});

router.get('/romaneios', authenticateToken, async (req, res) => {
    const { status, filial } = req.query; // 'filial' é o novo parâmetro
    const { unidade: filialUsuario } = req.user;

    try {
        let query = `
            SELECT r.id, r.data_criacao, r.nome_motorista, r.filial_origem, 
                   v.modelo as modelo_veiculo, v.placa as placa_veiculo 
            FROM romaneios r
            JOIN veiculos v ON r.id_veiculo = v.id
        `;
        const params = [];
        const conditions = [];

        if (status) {
            conditions.push('r.status = ?');
            params.push(status);
        }

        const adminFiliais = ['escritorio', 'escritório (lojas)'];
        const filialUsuarioNormalizada = filialUsuario ? filialUsuario.trim().toLowerCase() : '';
        const isUsuarioAdmin = adminFiliais.includes(filialUsuarioNormalizada);

        if (isUsuarioAdmin) {
            if (filial) {
                conditions.push('r.filial_origem = ?');
                params.push(filial);
            }
        } else {
            conditions.push('r.filial_origem = ?');
            params.push(filialUsuario); 
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY r.data_criacao DESC';

        const [romaneios] = await gerencialPool.execute(query, params);
        res.json(romaneios);
    } catch (error) {
        console.error("Erro ao buscar romaneios:", error);
        res.status(500).json({ error: 'Erro ao buscar romaneios.' });
    }
});

router.post('/romaneios', authenticateToken, async (req, res) => {
    const { id_veiculo, nome_motorista } = req.body;
    const { userId, unidade: filialUsuario } = req.user;

    if (!id_veiculo || !nome_motorista) {
        return res.status(400).json({ error: 'Veículo e nome do motorista são obrigatórios.' });
    }
    try {
        const [result] = await gerencialPool.execute(
            'INSERT INTO romaneios (id_veiculo, nome_motorista, id_usuario_criacao, filial_origem) VALUES (?, ?, ?, ?)',
            [id_veiculo, nome_motorista, userId, filialUsuario]
        );
        res.status(201).json({ message: "Romaneio criado com sucesso!", romaneioId: result.insertId });
    } catch (error) {
        console.error("Erro ao criar romaneio:", error);
        res.status(500).json({ error: 'Erro interno ao criar o romaneio.' });
    }
});

router.get('/eligible-davs', authenticateToken, async (req, res) => {
    // Adiciona 'filialDav' (nome da filial) como parâmetro
    const { data, tipoData, apenasEntregaMarcada, bairro, cidade, davNumero, filialDav } = req.query;
    const { unidade: filialUsuario } = req.user;

    if (!data || !tipoData) {
        return res.status(400).json({ error: "Os filtros de data e tipo de data são obrigatórios." });
    }
    if (tipoData !== 'recebimento' && tipoData !== 'entrega') {
        return res.status(400).json({ error: "O tipo de data deve ser 'recebimento' ou 'entrega'." });
    }

    try {
        const filialMap = {
            'Santa Cruz da Serra': 'LUCAM',
            'Piabetá': 'VMNAF',
            'Parada Angélica': 'TNASC',
            'Nova Campinas': 'LCMAT'
            // Adicione outras filiais aqui (Nome no Token -> Código no cr_inde)
        };
        const adminFiliais = ['escritorio', 'escritório (lojas)'];
        const filialUsuarioNormalizada = filialUsuario ? filialUsuario.trim().toLowerCase() : '';
        const isUsuarioAdmin = adminFiliais.includes(filialUsuarioNormalizada);

        const dateColumn = tipoData === 'entrega' ? 'c.cr_entr' : 'c.cr_erec';

        let query = `
            SELECT DISTINCT c.cr_ndav, c.cr_nmcl, c.cr_ebai, c.cr_ecid, c.cr_inde
            FROM cdavs c
            JOIN idavs i ON c.cr_ndav = i.it_ndav
            WHERE c.cr_reca = '1'
              AND DATE(${dateColumn}) = ?
              AND (i.it_quan - (i.it_qent - i.it_qtdv)) > 0
        `;
        const params = [data];

        if (apenasEntregaMarcada === 'true') {
            query += ` AND c.cr_entr != '0000-00-00'`;
        }

        if (bairro) { query += ' AND c.cr_ebai LIKE ?'; params.push(`%${bairro}%`); }
        if (cidade) { query += ' AND c.cr_ecid LIKE ?'; params.push(`%${cidade}%`); }
        if (davNumero) { query += ' AND CAST(c.cr_ndav AS UNSIGNED) = ?'; params.push(parseInt(davNumero, 10)); }

        // --- LÓGICA DE FILTRO DE FILIAL ATUALIZADA ---
        if (isUsuarioAdmin) {
            // Se for admin e enviou um filtro de filial, usa-o
            if (filialDav) {
                // Mapeia o nome da filial (ex: "Santa Cruz da Serra") para o código (ex: "LUCAM")
                const filialCode = filialMap[filialDav];
                if (filialCode) {
                    query += ' AND c.cr_inde = ?';
                    params.push(filialCode);
                } else {
                    console.warn(`[ELIGIBLE DAVs] Admin filtrou por filial "${filialDav}" não mapeada.`);
                }
            }
            // Se for admin e não enviou filtro, não faz nada (vê todas)
        } else {
            // Se não for admin, força o filtro para a filial do próprio usuário
            const filialCode = filialMap[filialUsuario];
            if (!filialCode) {
                console.warn(`[ELIGIBLE DAVs] Usuário da filial "${filialUsuario}" não mapeada.`);
                return res.json([]);
            }
            query += ' AND c.cr_inde = ?';
            params.push(filialCode);
        }
        // --- FIM DA LÓGICA DE FILTRO ---

        query += ' ORDER BY c.cr_ebai, c.cr_nmcl';

        console.log(`[ELIGIBLE DAVs] Query: ${query.replace(/\s+/g, ' ')} | Params: ${JSON.stringify(params)}`);
        const [davs] = await seiPool.execute(query, params);
        res.json(davs);

    } catch (error) {
        console.error("Erro ao buscar DAVs elegíveis:", error);
        res.status(500).json({ error: 'Erro interno ao buscar DAVs.' });
    }
});

router.get('/romaneios/:id', authenticateToken, async (req, res) => {
    const romaneioId = parseInt(req.params.id, 10);
    if (isNaN(romaneioId)) {
        return res.status(400).json({ error: 'ID do Romaneio inválido.' });
    }

    try {
        const [romaneioDetails] = await gerencialPool.execute(
            `SELECT r.id, r.data_criacao, r.nome_motorista, r.filial_origem, r.status,
                    v.modelo as modelo_veiculo, v.placa as placa_veiculo
             FROM romaneios r
             JOIN veiculos v ON r.id_veiculo = v.id
             WHERE r.id = ?`,
            [romaneioId]
        );

        if (romaneioDetails.length === 0) {
            return res.status(404).json({ error: 'Romaneio não encontrado.' });
        }
        const romaneioData = romaneioDetails[0];

        const [items] = await gerencialPool.execute(
            `SELECT ri.id as romaneio_item_id, ri.dav_numero, ri.idavs_regi, ri.quantidade_a_entregar,
                    idavs_sei.it_nome as produto_nome, idavs_sei.it_unid as produto_unidade,
                    cdavs_sei.cr_nmcl as cliente_nome
             FROM romaneio_itens ri
             LEFT JOIN ${dbConfigSei.database}.idavs idavs_sei ON ri.idavs_regi = idavs_sei.it_regist
             LEFT JOIN ${dbConfigSei.database}.cdavs cdavs_sei ON ri.dav_numero = cdavs_sei.cr_ndav
             WHERE ri.id_romaneio = ?
             ORDER BY ri.dav_numero ASC, idavs_sei.it_nome ASC`,
            [romaneioId]
        );

        res.json({ ...romaneioData, itens: items });

    } catch (error) {
        console.error(`Erro ao buscar detalhes do romaneio ${romaneioId}:`, error);
        res.status(500).json({ error: 'Erro interno ao buscar detalhes do romaneio.' });
    }
});

router.post('/romaneios/:id/itens', authenticateToken, async (req, res) => {
    const romaneioId = parseInt(req.params.id, 10);
    const itensParaAdicionar = req.body; 

    if (isNaN(romaneioId) || !Array.isArray(itensParaAdicionar) || itensParaAdicionar.length === 0) {
        return res.status(400).json({ error: 'Dados inválidos. É esperado um array de itens.' });
    }

    const gerencialConnection = await gerencialPool.getConnection();
    try {
        await gerencialConnection.beginTransaction();

        const [romaneioStatusRows] = await gerencialConnection.execute('SELECT status FROM romaneios WHERE id = ? FOR UPDATE', [romaneioId]);
        if (romaneioStatusRows.length === 0 || romaneioStatusRows[0].status !== 'Em montagem') {
            await gerencialConnection.rollback();
            return res.status(400).json({ error: 'Romaneio não encontrado ou não está mais em montagem.' });
        }

        const allIdavsRegi = [...new Set(itensParaAdicionar.map(item => parseInt(item.idavs_regi, 10)))].filter(id => !isNaN(id));
        if (allIdavsRegi.length === 0) {
             throw new Error("Nenhum ID de item válido encontrado.");
        }

        const [itemErpRows] = await seiPool.execute(`SELECT it_regist, it_nome, it_quan, it_qent, it_qtdv FROM idavs WHERE it_regist IN (?)`, [allIdavsRegi]);
        const itemErpMap = new Map(itemErpRows.map(i => [i.it_regist, i]));

        const [alocadoEmRomaneiosRows] = await gerencialPool.execute(
            'SELECT idavs_regi, SUM(quantidade_a_entregar) as total FROM romaneio_itens WHERE idavs_regi IN (?) AND id_romaneio != ? GROUP BY idavs_regi',
            [allIdavsRegi, romaneioId]
        );
        const alocadoMap = new Map(alocadoEmRomaneiosRows.map(i => [i.idavs_regi, i.total]));

        for (const item of itensParaAdicionar) {
            const idavsRegi = parseInt(item.idavs_regi, 10);
            const quantidadeAEntregar = parseFloat(item.quantidade_a_entregar);
            const davNumero = parseInt(item.dav_numero, 10);

            if (isNaN(idavsRegi) || isNaN(quantidadeAEntregar) || quantidadeAEntregar <= 0 || isNaN(davNumero)) {
                throw new Error(`Dados inválidos para o item ID ${item.idavs_regi} do DAV ${item.dav_numero}.`);
            }

            const itemErp = itemErpMap.get(idavsRegi);
            if (!itemErp) { throw new Error(`Item ${idavsRegi} não encontrado no ERP.`); }

            const alocadoEmOutros = alocadoMap.get(idavsRegi) || 0;
            const { saldo: saldoDisponivel } = calcularSaldosItem(itemErp, null, { total: alocadoEmOutros });

            if (quantidadeAEntregar > saldoDisponivel) {
                 throw new Error(`Saldo insuficiente para ${itemErp.it_nome || `item ID ${idavsRegi}`} (DAV ${davNumero}). Saldo: ${saldoDisponivel}, Tentando: ${quantidadeAEntregar}.`);
            }

            await gerencialConnection.execute(
                `INSERT INTO romaneio_itens (id_romaneio, dav_numero, idavs_regi, quantidade_a_entregar) VALUES (?, ?, ?, ?)`,
                [romaneioId, davNumero, idavsRegi, quantidadeAEntregar]
            );
        }

        await gerencialConnection.commit();
        res.status(201).json({ message: 'Itens adicionados ao romaneio com sucesso!' });

    } catch (error) {
        await gerencialConnection.rollback();
        console.error(`Erro ao adicionar itens ao romaneio ${romaneioId}:`, error);
        res.status(error.message.includes('Saldo') || error.message.includes('inválidos') || error.message.includes('encontrado') ? 400 : 500)
           .json({ error: error.message || 'Erro interno ao adicionar itens.' });
    } finally {
        gerencialConnection.release();
    }
});

router.delete('/romaneios/:id/itens/:itemId', authenticateToken, async (req, res) => {
    const romaneioId = parseInt(req.params.id, 10);
    const romaneioItemId = parseInt(req.params.itemId, 10);

    if (isNaN(romaneioId) || isNaN(romaneioItemId)) {
        return res.status(400).json({ error: 'IDs inválidos.' });
    }

    const gerencialConnection = await gerencialPool.getConnection();
    try {
        await gerencialConnection.beginTransaction();

        const [romaneioStatusRows] = await gerencialConnection.execute('SELECT status FROM romaneios WHERE id = ? FOR UPDATE', [romaneioId]);
         if (romaneioStatusRows.length === 0 || romaneioStatusRows[0].status !== 'Em montagem') {
            throw new Error('Romaneio não encontrado ou não está mais em montagem.');
        }

        const [deleteResult] = await gerencialConnection.execute(
            'DELETE FROM romaneio_itens WHERE id = ? AND id_romaneio = ?',
            [romaneioItemId, romaneioId]
        );

        if (deleteResult.affectedRows === 0) {
            throw new Error('Item não encontrado neste romaneio ou já removido.');
        }

        await gerencialConnection.commit();
        res.json({ message: 'Item removido do romaneio com sucesso.' });

    } catch (error) {
        await gerencialConnection.rollback();
        console.error(`Erro ao remover item ${romaneioItemId} do romaneio ${romaneioId}:`, error);
        res.status(500).json({ error: error.message || 'Erro interno ao remover item.' });
    } finally {
        gerencialConnection.release();
    }
});


module.exports = router;