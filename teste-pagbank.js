// Importa a biblioteca Axios
const axios = require('axios');

/**
 * Função principal para buscar e processar os movimentos do PagBank.
 */
async function consultarMovimentos() {
    // 1. SUAS CREDENCIAIS E PARÂMETROS
    // IMPORTANTE: Nunca exponha seu token diretamente no código em produção.
    // Use variáveis de ambiente (process.env.PAGBANK_TOKEN).
    const meuToken = 'SEU_TOKEN_DE_ACESSO_AQUI';

    // 2. CÁLCULO AUTOMÁTICO DA DATA DO DIA ANTERIOR (AAAA-MM-DD)
    const hoje = new Date();
    const ontem = new Date(hoje);
    ontem.setDate(hoje.getDate() - 1);

    const ano = ontem.getFullYear();
    const mes = String(ontem.getMonth() + 1).padStart(2, '0'); // getMonth() é 0-indexed (0-11)
    const dia = String(ontem.getDate()).padStart(2, '0');
    const dataAnterior = `${ano}-${mes}-${dia}`;

    console.log(`Buscando movimentos para a data: ${dataAnterior}`);

    // 3. MONTAGEM DA URL DA API
    const url = `https://api.pagseguro.com/edi/v1/movements?token=${meuToken}&movementDate=${dataAnterior}`;

    try {
        // 4. EXECUÇÃO DA REQUISIÇÃO GET COM AXIOS
        const resposta = await axios.get(url, {
            headers: {
                'accept': 'application/json'
            }
        });

        // 5. PROCESSAMENTO DOS DADOS RECEBIDOS
        const movimentos = resposta.data.movements;

        if (!movimentos || movimentos.length === 0) {
            console.log('Nenhum movimento encontrado para a data especificada.');
            return;
        }

        console.log(`\n--- Relatório do dia ${dataAnterior} ---`);

        // Usando o método reduce para calcular os totais
        const totais = movimentos.reduce((acc, movimento) => {
            const valor = movimento.amount || 0;
            const taxa = movimento.fee || 0;

            if (movimento.type === 'Transacional') {
                acc.totalTransacionado += valor;
            } else if (movimento.type === 'Antecipação') {
                acc.totalAntecipado += valor;
            }
            
            // Soma todas as taxas, independentemente do tipo de movimento
            acc.totalTaxas += taxa;

            return acc;
        }, {
            totalTransacionado: 0,
            totalAntecipado: 0,
            totalTaxas: 0
        });

        console.log(`Total Transacionado: R$ ${totais.totalTransacionado.toFixed(2)}`);
        console.log(`Total Antecipado: R$ ${totais.totalAntecipado.toFixed(2)}`);
        console.log(`Total de Taxas Pagas: R$ ${totais.totalTaxas.toFixed(2)}`);

    } catch (erro) {
        // Tratamento de erros da requisição
        console.error('\nOcorreu um erro ao consultar a API do PagBank!');
        if (erro.response) {
            // O servidor respondeu com um status de erro (4xx, 5xx)
            console.error('Status do erro:', erro.response.status);
            console.error('Detalhes:', erro.response.data);
        } else if (erro.request) {
            // A requisição foi feita mas não houve resposta
            console.error('Não foi possível se conectar à API.', erro.request);
        } else {
            // Erro na configuração da requisição
            console.error('Erro ao montar a requisição:', erro.message);
        }
    }
}

// Executa a função
consultarMovimentos();