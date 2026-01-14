document.addEventListener('DOMContentLoaded', initPage);

const API_BASE = '/api/financeiro';

function getToken() { return localStorage.getItem('lucaUserToken'); }

async function initPage() {
    // Configura datas padrão (Hoje - 30 dias até Hoje + 30 dias)
    const hoje = new Date();
    const passado = new Date(); passado.setDate(hoje.getDate() - 30);
    const futuro = new Date(); futuro.setDate(hoje.getDate() + 30);
    
    document.getElementById('filtro-inicio').value = passado.toISOString().split('T')[0];
    document.getElementById('filtro-fim').value = futuro.toISOString().split('T')[0];

    document.getElementById('btn-filtrar').addEventListener('click', loadTitulos);
    
    // Modal Listeners
    document.getElementById('modal-modalidade').addEventListener('change', togglePainelCheque);
    document.getElementById('btn-fechar-modal').addEventListener('click', () => toggleModal(false));
    document.getElementById('btn-salvar-modal').addEventListener('click', saveClassificacao);

    loadTitulos();
}

function togglePainelCheque() {
    const tipo = document.getElementById('modal-modalidade').value;
    const painel = document.getElementById('painel-cheque');
    if (tipo === 'CHEQUE') painel.classList.remove('hidden');
    else painel.classList.add('hidden');
}

function toggleModal(show) {
    const modal = document.getElementById('modal-cheque');
    if (show) modal.classList.remove('hidden');
    else modal.classList.add('hidden');
}

async function loadTitulos() {
    const inicio = document.getElementById('filtro-inicio').value;
    const fim = document.getElementById('filtro-fim').value;
    const status = document.getElementById('filtro-status').value;

    const tbody = document.getElementById('lista-titulos');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center p-4">Carregando...</td></tr>';

    try {
        const res = await fetch(`${API_BASE}/titulos?dataInicio=${inicio}&dataFim=${fim}&status=${status}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        const dados = await res.json();
        
        tbody.innerHTML = '';
        if (dados.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center p-4 text-gray-500">Nenhum título encontrado no período.</td></tr>';
            return;
        }

        dados.forEach(t => {
            const tr = document.createElement('tr');
            tr.className = 'border-b hover:bg-gray-50';
            
            // Formatação de Valores e Datas
            const valorFmt = parseFloat(t.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const dataFmt = new Date(t.vencimento).toLocaleDateString('pt-BR');
            
            // Badge da Modalidade
            let badgeHtml = '';
            if (t.modalidade === 'CHEQUE') {
                let corClass = 'status-cheque-warn'; // Amarelo (Padrão/Entregue)
                let texto = `Cheque`;
                
                if (t.status_cheque === 'COMPENSADO') corClass = 'status-cheque-ok';
                else if (t.status_cheque.includes('DEVOLVIDO')) corClass = 'status-cheque-danger';
                
                if (t.status_cheque !== 'NAO_APLICA') texto += ` (${t.status_cheque.replace('_', ' ')})`;
                
                badgeHtml = `<button onclick='openEditModal(${JSON.stringify(t)})' class="status-badge ${corClass}">${texto}</button>`;
            } else {
                badgeHtml = `<button onclick='openEditModal(${JSON.stringify(t)})' class="status-badge status-boleto">${t.modalidade}</button>`;
            }

            tr.innerHTML = `
                <td class="px-6 py-3 font-mono text-xs">${dataFmt}</td>
                <td class="px-6 py-3 font-medium text-gray-900">${t.fornecedor}</td>
                <td class="px-6 py-3 text-right font-bold text-gray-700">${valorFmt}</td>
                <td class="px-6 py-3 text-center text-xs">
                    <span class="${t.status_erp === 'PAGO' ? 'text-green-600 bg-green-50 px-2 py-1 rounded' : 'text-gray-500'}">${t.status_erp}</span>
                </td>
                <td class="px-6 py-3 text-center">${badgeHtml}</td>
                <td class="px-6 py-3 text-xs text-gray-500 truncate max-w-[150px]" title="${t.observacao}">${t.observacao || '-'}</td>
            `;
            tbody.appendChild(tr);
        });

    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-red-500 p-4">Erro ao carregar dados.</td></tr>';
    }
}

// Função global para ser chamada pelo HTML string
window.openEditModal = function(titulo) {
    document.getElementById('modal-id-titulo').value = titulo.id;
    document.getElementById('modal-modalidade').value = titulo.modalidade || 'BOLETO';
    document.getElementById('modal-status-cheque').value = titulo.status_cheque || 'NAO_APLICA';
    document.getElementById('modal-numero-cheque').value = titulo.numero_cheque || '';
    document.getElementById('modal-obs').value = titulo.observacao || '';
    
    togglePainelCheque(); // Ajusta visibilidade
    toggleModal(true);
};

async function saveClassificacao() {
    const id = document.getElementById('modal-id-titulo').value;
    const modalidade = document.getElementById('modal-modalidade').value;
    const status_cheque = modalidade === 'CHEQUE' ? document.getElementById('modal-status-cheque').value : 'NAO_APLICA';
    const numero_cheque = document.getElementById('modal-numero-cheque').value;
    const observacao = document.getElementById('modal-obs').value;

    try {
        const res = await fetch(`${API_BASE}/titulos/${id}/classificar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify({ modalidade, status_cheque, numero_cheque, observacao })
        });

        if (!res.ok) throw new Error('Erro ao salvar');

        toggleModal(false);
        loadTitulos(); // Recarrega a tabela para ver a nova cor
        alert('Classificado com sucesso!');
    } catch (err) {
        alert('Falha ao salvar: ' + err.message);
    }
}