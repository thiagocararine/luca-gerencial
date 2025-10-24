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

// --- OTIMIZAÇÃO: Criação de Pools de Conexão ---
const seiPool = mysql.createPool(dbConfigSei);
const gerencialPool = mysql.createPool(dbConfig);


/**
 * Função para extrair o usuário do campo it_entr.
 * Exemplo de formato: "30/09/2025 15:23:50 THIAGOTI" -> "THIAGOTI"
 */
function parseUsuarioLiberacao(it_entr) {
    if (!it_entr || typeof it_entr !== 'string') {
        return 'N/A';
    }
    const parts = it_entr.split(' ');
    // O nome do usuário é geralmente a última parte
    return parts[parts.length - 1] || 'N/A';
}

/**
 * Função para ler o campo de texto it_reti e somar as quantidades retiradas.
 */
function parseRetiradasAnteriores(it_reti) {
    if (!it_reti || typeof it_reti !== 'string') {
        return 0;
    }
    let totalRetirado = 0;
    // A regex busca por "Retirada..:" seguido de espaços e captura o número.
    const regex = /Retirada\.\.:\s*(\d+[\.,]?\d*)/g;
    let match;
    while ((match = regex.exec(it_reti)) !== null) {
        totalRetirado += parseFloat(match[1].replace(',', '.'));
    }
    return totalRetirado;
}


function calcularSaldosItem(itemErp, retiradaManualDoItem, entregaRomaneioDoItem) {
    const quantidadeTotalPedido = parseFloat(itemErp.it_quan) || 0;
    const totalEntregueBruto = parseFloat(itemErp.it_qent) || 0; // Total que já saiu
    const totalDevolvido = parseFloat(itemErp.it_qtdv) || 0;    // Total que já voltou

    // LÓGICA FINAL E SIMPLIFICADA:
    // 1. Calcula o que está efetivamente com o cliente (Entregue Líquido).
    const entregueLiquido = totalEntregueBruto - totalDevolvido;

    // Soma qualquer quantidade que esteja em rota de entrega pelo nosso app.
    const totalEmRomaneioApp = parseFloat(entregaRomaneioDoItem?.total) || 0;

    // O total indisponível é a soma do que está com o cliente mais o que está em rota.
    const totalIndisponivel = entregueLiquido + totalEmRomaneioApp;
    
    // 2. O saldo a retirar é o total do pedido menos o que está indisponível.
    const saldo = quantidadeTotalPedido - totalIndisponivel;

    return {
        saldo: Math.max(0, saldo), 
        entregue: Math.max(0, totalIndisponivel) // Garante que o valor exibido não seja negativo
    };
}

// Rota principal para buscar dados de um DAV (REATORADA PARA PERFORMANCE E ROBUSTEZ)
router.get('/dav/:numero', authenticateToken, async (req, res) => {
    const davNumberStr = req.params.numero;
    const davNumber = parseInt(davNumberStr, 10);

    // Pega a unidade (filial) do usuário logado a partir do token
    const { unidade: filialUsuario } = req.user;

    if (isNaN(davNumber)) {
        return res.status(400).json({ error: 'Número do DAV inválido.' });
    }
    console.log(`[LOG] Iniciando busca para DAV: ${davNumber} pelo usuário da filial: ${filialUsuario}`);

    try {
        // MAPEAMENTO DAS FILIAIS (NOME NO TOKEN -> CÓDIGO NO BANCO)
        // Este mapa traduz o nome da filial do usuário para o código 'cr_inde' do banco.
        const filialMap = {
            'Santa Cruz da Serra': 'LUCAM',
            'Piabetá': 'VMNAF',
            'Parada Angélica': 'TNASC',
            'Nova Campinas': 'LCMAT'
            // Adicione outras filiais aqui se necessário
        };

        // LÓGICA DE FILTRAGEM
        const needsFilialFilter = filialUsuario !== 'escritorio';

        // MONTAGEM DINÂMICA DA QUERY
        let davQuery = `
            SELECT 
                c.cr_ndav, c.cr_nmcl, c.cr_dade, c.cr_refe, c.cr_ebai, c.cr_ecid, c.cr_ecep, 
                c.cr_edav, c.cr_hdav, c.cr_udav, c.cr_tnot, c.cr_tipo, c.cr_reca,
                c.cr_urec, c.cr_erec, c.cr_hrec, 
                c.cr_ecan, c.cr_hcan, c.cr_usac,
                c.cr_nfem, c.cr_chnf, c.cr_seri, c.cr_tnfs, c.cr_nota,
                cl.cl_docume 
             FROM cdavs c
             LEFT JOIN clientes cl ON c.cr_cdcl = cl.cl_codigo
             WHERE CAST(c.cr_ndav AS UNSIGNED) = ?
        `;
        const queryParams = [davNumber];

        if (needsFilialFilter) {
            const filialCode = filialMap[filialUsuario];
            // Se não encontrarmos um código para a filial do usuário, ele não poderá ver nenhum pedido.
            if (!filialCode) {
                console.log(`[SECURITY] Usuário da filial "${filialUsuario}" não mapeada tentou acesso. Acesso negado.`);
                return res.status(404).json({ error: `Pedido (DAV) com número ${davNumber} não encontrado.` });
            }
            davQuery += ' AND c.cr_inde = ?';
            queryParams.push(filialCode);
        }

        console.log('[LOG] Passo 1: Buscando dados do DAV na tabela cdavs...');
        const [davs] = await seiPool.execute(davQuery, queryParams);
        
        // O restante da função continua exatamente como estava, pois a filtragem já foi feita.
        if (davs.length === 0) {
            return res.status(404).json({ error: `Pedido (DAV) com número ${davNumber} não encontrado.` });
        }
        const davData = davs[0];

        if (davData.cr_tipo != 1) {
            return res.status(400).json({ error: `O DAV ${davNumber} é um orçamento e não pode ser faturado.` });
        }
        if (davData.cr_reca === '' || davData.cr_reca === null) {
            return res.status(400).json({ error: `O Pedido (DAV) ${davNumber} não foi recebido no caixa e não pode ser liberado.` });
        }

        const combineDateTime = (date, time) => {
            if (!date || (typeof date === 'string' && date.startsWith('0000-00-00'))) {
                return null;
            }
            const dateObject = new Date(date);
            if (isNaN(dateObject.getTime())) {
                return null;
            }
            const validTime = time || '00:00:00';
            const datePart = dateObject.toISOString().split('T')[0];
            return new Date(`${datePart}T${validTime}`);
        };

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

        if (davData.cr_reca !== '1') {
            console.log(`[LOG] Pedido ${davNumber} com status '${davData.cr_reca}'. Não buscará itens.`);
            return res.json(responseData);
        }
        
        console.log(`[LOG] Pedido ${davNumber} recebido. Buscando itens...`);
        
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

        const allResults = await Promise.all([
            seiPool.execute(
                `SELECT it_regist, it_ndav, it_item, it_codi, it_nome, it_quan, it_qent, it_qtdv, it_unid, it_entr, it_reti FROM idavs WHERE CAST(it_ndav AS UNSIGNED) = ? AND (it_canc IS NULL OR it_canc <> 1)`,
                [davNumber]
            ),
            gerencialPool.execute(
                'SELECT idavs_regi, SUM(quantidade_retirada) as total FROM entregas_manuais_log WHERE dav_numero = ? GROUP BY idavs_regi',
                [davNumber]
            ),
            gerencialPool.execute(
                'SELECT idavs_regi, SUM(quantidade_a_entregar) as total FROM romaneio_itens WHERE dav_numero = ? GROUP BY idavs_regi',
                [davNumber]
            ),
            gerencialPool.execute(historicoQuery, [davNumber, davNumber])
        ]);

        const itensDav = allResults[0][0];
        const retiradasManuais = allResults[1][0];
        const entregasRomaneio = allResults[2][0];
        const historicoCompleto = allResults[3][0];

        if (itensDav.length === 0) {
            return res.status(404).json({ error: 'Nenhum item válido encontrado para este pedido.' });
        }
        
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
        res.status(500).json({ error: 'Erro interno no servidor ao processar o pedido. Verifique os logs do servidor para mais detalhes.' });
    }
});

// Rota para registrar uma retirada manual de produtos
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

            const [itemErpParaSaldoRows] = await seiPool.execute(`SELECT * FROM idavs WHERE it_regist = ?`, [idavsRegiNum]);
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

            if (item.quantidade_retirada > saldo) {
                throw new Error(`Saldo insuficiente para o item ${item.pd_nome}. Saldo disponível: ${saldo}.`);
            }

            const [logResult] = await gerencialConnection.execute(
                `INSERT INTO entregas_manuais_log (dav_numero, idavs_regi, quantidade_retirada, id_usuario_conferencia) VALUES (?, ?, ?, ?)`,
                [dav_numero, idavsRegiNum, item.quantidade_retirada, userId]
            );
            const newLogId = logResult.insertId;
            logsCriados.push(newLogId);
            
            await seiConnection.execute(
                `UPDATE idavs SET it_qent = it_qent + ? WHERE it_regist = ?`,
                [item.quantidade_retirada, idavsRegiNum]
            );

            const [itemErpRows] = await seiConnection.execute(
                `SELECT it_reti, it_codi, it_nome, it_unid, it_quan FROM idavs WHERE it_regist = ? FOR UPDATE`,
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
QT Entrega: ${item.quantidade_retirada}
Saldo.....: Baixa via App Gerencial
Retirada..: ${item.quantidade_retirada}
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
        res.status(500).json({ error: error.message || 'Erro interno ao salvar a retirada.' });
    } finally {
        gerencialConnection.release();
        seiConnection.release();
    }
});

// --- ENDPOINTS DE ROMANEIO ---
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
    const { status } = req.query;
    try {
        let query = `
            SELECT r.id, r.data_criacao, r.nome_motorista, v.modelo as modelo_veiculo, v.placa as placa_veiculo 
            FROM romaneios r
            JOIN veiculos v ON r.id_veiculo = v.id
        `;
        const params = [];
        if (status) {
            query += ' WHERE r.status = ?';
            params.push(status);
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
    const { userId } = req.user;

    if (!id_veiculo || !nome_motorista) {
        return res.status(400).json({ error: 'Veículo e nome do motorista são obrigatórios.' });
    }
    try {
        const [result] = await gerencialPool.execute(
            'INSERT INTO romaneios (id_veiculo, nome_motorista, id_usuario_criacao) VALUES (?, ?, ?)',
            [id_veiculo, nome_motorista, userId]
        );
        res.status(201).json({ message: "Romaneio criado com sucesso!", romaneioId: result.insertId });
    } catch (error) {
        console.error("Erro ao criar romaneio:", error);
        res.status(500).json({ error: 'Erro interno ao criar o romaneio.' });
    }
});


/**
 * Rota para adicionar itens de um DAV a um romaneio existente.
 * Body esperado: { dav_numero: "12345", itens: [{ idavs_regi: 1, quantidade_a_entregar: 2 }, ...] }
 */
router.post('/romaneios/:id/itens', authenticateToken, async (req, res) => {
    const romaneioId = parseInt(req.params.id, 10);
    const itensParaAdicionar = req.body; // Recebe o array de itens diretamente

    if (isNaN(romaneioId) || !Array.isArray(itensParaAdicionar) || itensParaAdicionar.length === 0) {
        return res.status(400).json({ error: 'Dados inválidos para adicionar itens ao romaneio. É esperado um array de itens.' });
    }

    const gerencialConnection = await gerencialPool.getConnection();
    try {
        await gerencialConnection.beginTransaction();

        // Verifica se o romaneio existe e está 'Em montagem'
        const [romaneioStatusRows] = await gerencialConnection.execute('SELECT status FROM romaneios WHERE id = ? FOR UPDATE', [romaneioId]);
        if (romaneioStatusRows.length === 0 || romaneioStatusRows[0].status !== 'Em montagem') {
            await gerencialConnection.rollback(); // Libera o lock
            return res.status(400).json({ error: 'Romaneio não encontrado ou não está mais em montagem.' });
        }

        // Mapeia todos os IDs de itens únicos para buscar dados do ERP de forma eficiente
        const allIdavsRegi = [...new Set(itensParaAdicionar.map(item => parseInt(item.idavs_regi, 10)))].filter(id => !isNaN(id));
        if (allIdavsRegi.length === 0) {
             throw new Error("Nenhum ID de item válido encontrado nos dados enviados.");
        }

        // Busca dados dos itens do ERP
        const [itemErpRows] = await seiPool.execute(`SELECT it_regist, it_nome, it_quan, it_qent, it_qtdv FROM idavs WHERE it_regist IN (?)`, [allIdavsRegi]);
        const itemErpMap = new Map(itemErpRows.map(i => [i.it_regist, i]));

        // Busca quantidades já alocadas em OUTROS romaneios para esses itens
        const [alocadoEmRomaneiosRows] = await gerencialPool.execute(
            'SELECT idavs_regi, SUM(quantidade_a_entregar) as total FROM romaneio_itens WHERE idavs_regi IN (?) AND id_romaneio != ? GROUP BY idavs_regi',
            [allIdavsRegi, romaneioId]
        );
        const alocadoMap = new Map(alocadoEmRomaneiosRows.map(i => [i.idavs_regi, i.total]));

        // Itera sobre os itens enviados pelo front-end para validação e inserção
        for (const item of itensParaAdicionar) {
            const idavsRegi = parseInt(item.idavs_regi, 10);
            const quantidadeAEntregar = parseFloat(item.quantidade_a_entregar);
            const davNumero = parseInt(item.dav_numero, 10);

            // Validação básica dos dados recebidos
            if (isNaN(idavsRegi) || isNaN(quantidadeAEntregar) || quantidadeAEntregar <= 0 || isNaN(davNumero)) {
                throw new Error(`Dados inválidos para o item ID ${item.idavs_regi} do DAV ${item.dav_numero}. Verifique os valores.`);
            }

            // Validação de Saldo
            const itemErp = itemErpMap.get(idavsRegi);
            if (!itemErp) { throw new Error(`Item ${idavsRegi} não encontrado no ERP.`); }

            const alocadoEmOutros = alocadoMap.get(idavsRegi) || 0;
            // Usa a função calcularSaldosItem para obter o saldo real disponível
            const { saldo: saldoDisponivel } = calcularSaldosItem(itemErp, null, { total: alocadoEmOutros });

            if (quantidadeAEntregar > saldoDisponivel) {
                 throw new Error(`Saldo insuficiente para ${itemErp.it_nome || `item ID ${idavsRegi}`} (DAV ${davNumero}). Saldo: ${saldoDisponivel}, Tentando: ${quantidadeAEntregar}.`);
            }

            // Insere o item na tabela romaneio_itens
            await gerencialConnection.execute(
                `INSERT INTO romaneio_itens (id_romaneio, dav_numero, idavs_regi, quantidade_a_entregar) VALUES (?, ?, ?, ?)`,
                [romaneioId, davNumero, idavsRegi, quantidadeAEntregar]
            );
            console.log(`[LOG] Item ${idavsRegi} (DAV: ${davNumero}, Qtd: ${quantidadeAEntregar}) adicionado ao Romaneio ${romaneioId}`);
        }

        await gerencialConnection.commit();
        res.status(201).json({ message: 'Itens adicionados ao romaneio com sucesso!' });

    } catch (error) {
        await gerencialConnection.rollback(); // Garante rollback em caso de erro
        console.error(`Erro ao adicionar itens ao romaneio ${romaneioId}:`, error);
        // Retorna a mensagem de erro específica (ex: saldo insuficiente) ou uma genérica
        res.status(error.message.includes('Saldo insuficiente') || error.message.includes('inválidos') || error.message.includes('não encontrado') ? 400 : 500)
           .json({ error: error.message || 'Erro interno ao adicionar itens.' });
    } finally {
        gerencialConnection.release(); // Libera a conexão de volta para o pool
    }
});


// Rota para remover um item de um romaneio (implementação básica)
router.delete('/romaneios/:id/itens/:itemId', authenticateToken, async (req, res) => {
    const romaneioId = parseInt(req.params.id, 10);
    const romaneioItemId = parseInt(req.params.itemId, 10); // ID da linha em romaneio_itens

    if (isNaN(romaneioId) || isNaN(romaneioItemId)) {
        return res.status(400).json({ error: 'IDs inválidos.' });
    }

    const gerencialConnection = await gerencialPool.getConnection();
    try {
        await gerencialConnection.beginTransaction();

        // Verifica se o romaneio está 'Em montagem' antes de permitir a remoção
        const [romaneioStatusRows] = await gerencialConnection.execute('SELECT status FROM romaneios WHERE id = ? FOR UPDATE', [romaneioId]);
         if (romaneioStatusRows.length === 0 || romaneioStatusRows[0].status !== 'Em montagem') {
            throw new Error('Romaneio não encontrado ou não está mais em montagem.');
        }

        // Deleta o item específico
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

/** Busca DAVs elegíveis para adicionar a um romaneio, com filtros.
 * Query Params: data (YYYY-MM-DD, obrigatório), bairro?, cidade?, davNumero?
 */
router.get('/eligible-davs', authenticateToken, async (req, res) => {
    // Novos query params: tipoData, apenasEntregaMarcada
    const { data, tipoData, apenasEntregaMarcada, bairro, cidade, davNumero } = req.query;
    const { unidade: filialUsuario } = req.user;

    // Validação dos parâmetros obrigatórios
    if (!data || !tipoData) {
        return res.status(400).json({ error: "Os filtros de data e tipo de data são obrigatórios." });
    }
    if (tipoData !== 'recebimento' && tipoData !== 'entrega') {
        return res.status(400).json({ error: "O tipo de data deve ser 'recebimento' ou 'entrega'." });
    }

    try {
        const filialMap = { /* ... seu filialMap ... */ };
        const adminFiliais = ['escritorio', 'Escritório (Lojas)'];
        const needsFilialFilter = !adminFiliais.includes(filialUsuario);

        // Define qual coluna de data será usada no filtro principal
        const dateColumn = tipoData === 'entrega' ? 'c.cr_entr' : 'c.cr_erec';

        // Base da query
        let query = `
            SELECT DISTINCT c.cr_ndav, c.cr_nmcl, c.cr_ebai, c.cr_ecid, c.cr_inde
            FROM cdavs c
            JOIN idavs i ON c.cr_ndav = i.it_ndav
            WHERE c.cr_reca = '1'               -- Status Recebido
              AND DATE(${dateColumn}) = ?       -- Filtro pela data e coluna escolhida
              AND (i.it_quan - (i.it_qent - i.it_qtdv)) > 0 -- Garante saldo em algum item
        `;
        const params = [data];

        // Adiciona filtro para "Apenas Entrega Marcada" se solicitado
        if (apenasEntregaMarcada === 'true') {
            query += ` AND c.cr_entr != '0000-00-00'`;
        }

        // Adiciona filtros opcionais
        if (bairro) { query += ' AND c.cr_ebai LIKE ?'; params.push(`%${bairro}%`); }
        if (cidade) { query += ' AND c.cr_ecid LIKE ?'; params.push(`%${cidade}%`); }
        if (davNumero) { query += ' AND CAST(c.cr_ndav AS UNSIGNED) = ?'; params.push(parseInt(davNumero, 10)); }

        // Aplica filtro de filial para não-admins
        if (needsFilialFilter) {
            const filialCode = filialMap[filialUsuario];
            if (!filialCode) {
                console.warn(`[ELIGIBLE DAVs] Usuário da filial "${filialUsuario}" não mapeada.`);
                return res.json([]);
            }
            query += ' AND c.cr_inde = ?';
            params.push(filialCode);
        }

        query += ' ORDER BY c.cr_ebai, c.cr_nmcl'; // Ordena

        console.log(`[ELIGIBLE DAVs] Executing query: ${query.replace(/\s+/g, ' ')} with params: ${JSON.stringify(params)}`);
        const [davs] = await seiPool.execute(query, params);
        res.json(davs);

    } catch (error) {
        console.error("Erro ao buscar DAVs elegíveis:", error);
        res.status(500).json({ error: 'Erro interno ao buscar DAVs.' });
    }
});

/**
 * Rota GET /romaneios/:id (MODIFICADA para ordenar itens por DAV e incluir nome do cliente)
 * Busca os detalhes de um romaneio específico, incluindo os itens já adicionados,
 * ordenados para exibição agrupada.
 */
router.get('/romaneios/:id', authenticateToken, async (req, res) => {
    const romaneioId = parseInt(req.params.id, 10);
    if (isNaN(romaneioId)) {
        return res.status(400).json({ error: 'ID do Romaneio inválido.' });
    }

    try {
        // Busca os dados básicos do romaneio
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

        // Busca os itens JÁ ADICIONADOS, ordenando por DAV e depois por nome do produto.
        // Adicionamos LEFT JOIN com cdavs para obter o nome do cliente.
        const [items] = await gerencialPool.execute(
            `SELECT ri.id as romaneio_item_id, ri.dav_numero, ri.idavs_regi, ri.quantidade_a_entregar,
                    idavs_sei.it_nome as produto_nome, idavs_sei.it_unid as produto_unidade,
                    cdavs_sei.cr_nmcl as cliente_nome -- Adiciona nome do cliente para exibição
             FROM romaneio_itens ri
             LEFT JOIN ${dbConfigSei.database}.idavs idavs_sei ON ri.idavs_regi = idavs_sei.it_regist
             LEFT JOIN ${dbConfigSei.database}.cdavs cdavs_sei ON ri.dav_numero = cdavs_sei.cr_ndav -- Junta com cdavs
             WHERE ri.id_romaneio = ?
             ORDER BY ri.dav_numero ASC, idavs_sei.it_nome ASC`, // Ordena aqui
            [romaneioId]
        );

        res.json({ ...romaneioData, itens: items }); // Envia os itens ordenados

    } catch (error) {
        console.error(`Erro ao buscar detalhes do romaneio ${romaneioId}:`, error);
        res.status(500).json({ error: 'Erro interno ao buscar detalhes do romaneio.' });
    }
});

module.exports = router;