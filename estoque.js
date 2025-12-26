document.addEventListener('DOMContentLoaded', initPage);

const API_BASE = '/api/estoque';
let currentEnderecoId = null;
let currentProductsList = []; 
let debounceTimer;

// --- FUNÇÕES UTILITÁRIAS ---

function getToken() { 
    return localStorage.getItem('lucaUserToken'); 
}

// Extrai dados do token (Adicionado para pegar o nome)
function getUserData() {
    const token = getToken();
    if (!token) return null;
    try {
        return JSON.parse(atob(token.split('.')[1]));
    } catch (e) {
        return null;
    }
}

function showLoader() { 
    const loader = document.getElementById('global-loader');
    if (loader) {
        loader.classList.remove('hidden'); 
        loader.classList.add('flex'); 
    }
}

function hideLoader() { 
    const loader = document.getElementById('global-loader');
    if (loader) {
        loader.classList.add('hidden'); 
        loader.classList.remove('flex'); 
    }
}

// --- INICIALIZAÇÃO DA PÁGINA ---

async function initPage() {
    console.log("Iniciando módulo de estoque...");
    
    // 1. Atualiza Nome do Usuário no Header
    const userData = getUserData();
    if (userData && document.getElementById('user-name')) {
        // Se o token tiver o campo 'nome', usa ele. Senão, mantém padrão.
        document.getElementById('user-name').textContent = userData.nome || 'Utilizador';
    }

    // 2. Verifica saúde do backend
    checkBackendHealth();

    // 3. Configura o Select de Filiais (Sem Escritório)
    const selectFilial = document.getElementById('filial-select');
    const filiais = ['Santa Cruz da Serra', 'Piabetá', 'Parada Angélica', 'Nova Campinas'];
    
    selectFilial.innerHTML = filiais.map(f => `<option value="${f}">${f}</option>`).join('');
    
    // 4. Seleciona filial do usuário automaticamente
    if(userData && userData.unidade && filiais.includes(userData.unidade)) {
        selectFilial.value = userData.unidade;
    }

    // 5. Carrega Filtros (Grupo/Fabricante)
    loadFilters();

    // 6. Configura Listeners
    selectFilial.addEventListener('change', () => { loadEnderecos(); });
    document.getElementById('filter-grupo').addEventListener('change', loadEnderecos);
    document.getElementById('filter-fabricante').addEventListener('change', loadEnderecos);
    document.getElementById('btn-limpar-filtros').addEventListener('click', clearFilters);

    document.getElementById('btn-novo-endereco').addEventListener('click', () => toggleModal(true));
    document.getElementById('btn-cancelar-modal').addEventListener('click', () => toggleModal(false));
    document.getElementById('form-novo-endereco').addEventListener('submit', createEndereco);
    
    document.getElementById('search-endereco').addEventListener('input', filterEnderecosLocal);
    document.getElementById('btn-excluir-endereco').addEventListener('click', deleteEndereco);
    
    document.getElementById('input-busca-produto').addEventListener('input', handleProductSearch);

    // Listeners de Contagem
    document.getElementById('btn-contagem').addEventListener('click', openContagemModal);
    document.getElementById('btn-fechar-contagem').addEventListener('click', () => toggleContagemModal(false));
    document.getElementById('btn-cancelar-contagem').addEventListener('click', () => toggleContagemModal(false));
    document.getElementById('btn-salvar-contagem').addEventListener('click', saveContagem);

    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', () => {
        localStorage.removeItem('lucaUserToken');
        window.location.href = 'login.html';
    });

    loadEnderecos();
}

async function checkBackendHealth() {
    try {
        const res = await fetch(`${API_BASE}/diagnostico`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        const data = await res.json();
        if (!data.tabelas_sistema || !data.tabelas_sistema.includes('estoque_enderecos')) {
            console.warn("ALERTA: Tabelas não encontradas.");
        }
    } catch (e) { console.error("Diagnóstico falhou:", e); }
}

// --- FILTROS ---

async function loadFilters() {
    try {
        const res = await fetch(`${API_BASE}/filtros`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        const data = await res.json();
        
        const selGrupo = document.getElementById('filter-grupo');
        const selFabr = document.getElementById('filter-fabricante');

        selGrupo.innerHTML = '<option value="">Todos os Grupos</option>';
        selFabr.innerHTML = '<option value="">Todos os Fabricantes</option>';

        data.grupos.forEach(g => {
            const opt = document.createElement('option'); opt.value = g; opt.text = g; selGrupo.appendChild(opt);
        });
        data.fabricantes.forEach(f => {
            const opt = document.createElement('option'); opt.value = f; opt.text = f; selFabr.appendChild(opt);
        });
    } catch(e) { console.error("Erro ao carregar filtros", e); }
}

function clearFilters() {
    document.getElementById('filter-grupo').value = "";
    document.getElementById('filter-fabricante').value = "";
    document.getElementById('search-endereco').value = "";
    loadEnderecos();
}

// --- LOTES ---

async function loadEnderecos() {
    const filial = document.getElementById('filial-select').value;
    const grupo = document.getElementById('filter-grupo').value;
    const fabricante = document.getElementById('filter-fabricante').value;

    if (!filial) return;

    showLoader();
    try {
        let url = `${API_BASE}/enderecos?filial=${encodeURIComponent(filial)}`;
        if (grupo) url += `&grupo=${encodeURIComponent(grupo)}`;
        if (fabricante) url += `&fabricante=${encodeURIComponent(fabricante)}`;

        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        
        if (!res.ok) throw new Error(await res.text());
        
        const enderecos = await res.json();
        renderEnderecos(enderecos);
        
        if (currentEnderecoId) {
            const aindaExiste = enderecos.find(e => e.id === currentEnderecoId);
            if (!aindaExiste) {
                document.getElementById('detalhe-vazio').classList.remove('hidden');
                document.getElementById('detalhe-conteudo').classList.add('hidden');
                currentEnderecoId = null;
            }
        }

    } catch (err) {
        console.error(err);
        try {
            const jsonErr = JSON.parse(err.message);
            alert(`Erro: ${jsonErr.error}`);
        } catch {
            alert('Erro ao carregar lista de endereços.');
        }
    } finally {
        hideLoader();
    }
}

function renderEnderecos(lista) {
    const container = document.getElementById('lista-enderecos');
    container.innerHTML = '';

    if (lista.length === 0) {
        container.innerHTML = `
            <div class="text-center p-6 text-gray-400">
                <p>Nenhum lote encontrado.</p>
                <p class="text-xs mt-1">Verifique os filtros ou clique em "Novo".</p>
            </div>`;
        return;
    }

    lista.forEach(end => {
        const div = document.createElement('div');
        div.className = 'p-3 bg-white border border-gray-200 rounded-md hover:border-indigo-500 hover:shadow-md cursor-pointer transition-all endereco-item group';
        div.dataset.id = end.id;
        div.dataset.codigo = end.codigo_endereco;
        
        if(currentEnderecoId === end.id) {
            div.classList.add('ring-2', 'ring-indigo-500', 'bg-indigo-50');
        }

        let badgeClass = 'bg-green-100 text-green-800';
        if (end.qtd_produtos >= 5) badgeClass = 'bg-red-100 text-red-800';
        else if (end.qtd_produtos > 0) badgeClass = 'bg-blue-100 text-blue-800';

        div.innerHTML = `
            <div class="flex justify-between items-start pointer-events-none">
                <div>
                    <p class="font-bold text-gray-800 text-base group-hover:text-indigo-600">${end.codigo_endereco}</p>
                    <p class="text-xs text-gray-500 mt-0.5">${end.descricao || 'Lote Padrão'}</p>
                </div>
                <div class="text-right">
                    <span class="inline-block px-2 py-0.5 rounded text-xs font-bold ${badgeClass}">
                        ${end.qtd_produtos} / 5
                    </span>
                </div>
            </div>
        `;
        div.addEventListener('click', () => selectEndereco(end));
        container.appendChild(div);
    });
}

function filterEnderecosLocal(e) {
    const term = e.target.value.toLowerCase();
    document.querySelectorAll('.endereco-item').forEach(el => {
        const codigo = el.dataset.codigo.toLowerCase();
        el.style.display = codigo.includes(term) ? 'block' : 'none';
    });
}

function toggleModal(show) {
    const modal = document.getElementById('modal-novo-endereco');
    if (show) { modal.classList.remove('hidden'); modal.classList.add('flex'); document.getElementById('form-novo-endereco').reset(); } 
    else { modal.classList.add('hidden'); modal.classList.remove('flex'); }
}

async function createEndereco(e) {
    e.preventDefault();
    const filial = document.getElementById('filial-select').value;
    const formData = new FormData(e.target);
    const payload = { filial_codigo: filial, codigo_endereco: formData.get('codigo').toUpperCase(), descricao: formData.get('descricao') };

    try {
        const res = await fetch(`${API_BASE}/enderecos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        alert("Sucesso: " + data.message);
        toggleModal(false);
        loadEnderecos();
    } catch (err) {
        alert("Falha: " + err.message);
    }
}

async function deleteEndereco() {
    if(!currentEnderecoId) return;
    if(!confirm('Tem certeza? Isso desvinculará todos os produtos deste lote.')) return;
    try {
        const res = await fetch(`${API_BASE}/enderecos/${currentEnderecoId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if(res.ok) {
            loadEnderecos();
        } else {
            alert('Erro ao excluir lote.');
        }
    } catch(err) { console.error(err); alert("Erro de conexão ao tentar excluir."); }
}

// --- DETALHES DO LOTE ---

async function selectEndereco(endereco) {
    currentEnderecoId = endereco.id;
    
    document.querySelectorAll('.endereco-item').forEach(el => el.classList.remove('ring-2', 'ring-indigo-500', 'bg-indigo-50'));
    document.querySelector(`.endereco-item[data-id="${endereco.id}"]`)?.classList.add('ring-2', 'ring-indigo-500', 'bg-indigo-50');

    document.getElementById('detalhe-vazio').classList.add('hidden');
    document.getElementById('detalhe-conteudo').classList.remove('hidden');
    
    document.getElementById('lbl-codigo-endereco').textContent = endereco.codigo_endereco;
    document.getElementById('lbl-descricao-endereco').textContent = endereco.descricao || 'Lote Padrão';
    
    document.getElementById('input-busca-produto').value = '';
    document.getElementById('resultados-busca').classList.add('hidden');

    loadProdutosDoEndereco();
}

async function loadProdutosDoEndereco() {
    if(!currentEnderecoId) return;
    const filial = document.getElementById('filial-select').value;
    const container = document.getElementById('lista-produtos-endereco');
    container.innerHTML = '<p class="text-center text-gray-400 py-4">Carregando itens...</p>';

    try {
        const res = await fetch(`${API_BASE}/enderecos/${currentEnderecoId}/produtos?filial=${encodeURIComponent(filial)}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        currentProductsList = await res.json();
        renderProdutos(currentProductsList);
    } catch(err) {
        container.innerHTML = '<p class="text-center text-red-400">Erro ao carregar itens do lote.</p>';
        console.error(err);
    }
}

function renderProdutos(produtos) {
    const container = document.getElementById('lista-produtos-endereco');
    container.innerHTML = '';

    if (produtos.length === 0) {
        container.innerHTML = `
            <div class="text-center p-8 bg-white border border-dashed border-gray-300 rounded-lg">
                <i data-feather="box" class="w-10 h-10 text-gray-300 mx-auto mb-2"></i>
                <p class="text-gray-500 text-sm">Este lote está vazio.</p>
                <p class="text-xs text-gray-400">Use a busca acima para adicionar itens.</p>
            </div>`;
        if (typeof feather !== 'undefined') feather.replace();
        return;
    }

    produtos.forEach(prod => {
        const div = document.createElement('div');
        div.className = 'bg-white p-4 rounded-lg border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-center gap-3 transition-shadow hover:shadow-md';
        
        const saldoClass = prod.saldo > 0 ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50';

        const detalhes = [];
        if(prod.fabricante) detalhes.push(prod.fabricante);
        if(prod.grupo) detalhes.push(prod.grupo);
        const detalhesTexto = detalhes.length > 0 ? detalhes.join(' • ') : '';

        div.innerHTML = `
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                    <span class="font-mono text-xs font-bold bg-gray-100 px-2 py-0.5 rounded text-gray-700 border border-gray-200">${prod.codigo}</span>
                    ${detalhesTexto ? `<span class="text-xs text-gray-400 border-l pl-2 border-gray-300 truncate max-w-[200px] hidden sm:inline-block" title="${detalhesTexto}">${detalhesTexto}</span>` : ''}
                </div>
                <p class="font-medium text-sm text-gray-900 truncate" title="${prod.nome}">${prod.nome}</p>
                ${detalhesTexto ? `<p class="text-[10px] text-gray-400 mt-0.5 sm:hidden uppercase">${detalhesTexto}</p>` : ''}
                <div class="mt-2 flex items-center gap-2 text-xs">
                    <span class="px-2 py-0.5 rounded font-bold ${saldoClass}">Saldo em Estoque: ${prod.saldo}</span>
                </div>
            </div>
            <button class="text-gray-400 hover:text-red-600 hover:bg-red-50 p-2 rounded transition-colors" onclick="removerProduto(${prod.id_mapa})" title="Remover do lote">
                <i data-feather="x" class="w-5 h-5"></i>
            </button>
        `;
        container.appendChild(div);
    });
    
    if (typeof feather !== 'undefined') feather.replace();
}

function handleProductSearch(e) {
    clearTimeout(debounceTimer);
    const query = e.target.value;
    const filial = document.getElementById('filial-select').value;
    const resultsContainer = document.getElementById('resultados-busca');

    if (query.length < 3) {
        resultsContainer.classList.add('hidden');
        return;
    }

    debounceTimer = setTimeout(async () => {
        try {
            const res = await fetch(`${API_BASE}/produtos/busca?q=${encodeURIComponent(query)}&filial=${encodeURIComponent(filial)}`, {
                headers: { 'Authorization': `Bearer ${getToken()}` }
            });
            const resultados = await res.json();
            
            resultsContainer.innerHTML = '';
            
            if (resultados.length > 0) {
                resultados.forEach(prod => {
                    const div = document.createElement('div');
                    div.className = 'p-3 hover:bg-indigo-50 cursor-pointer border-b last:border-0 transition-colors group';
                    
                    const detalhes = [];
                    if(prod.pd_fabr) detalhes.push(prod.pd_fabr);
                    if(prod.pd_nmgr) detalhes.push(prod.pd_nmgr);
                    const detalhesTexto = detalhes.join(' | ');

                    div.innerHTML = `
                        <div class="flex justify-between">
                            <span class="font-bold text-gray-700 text-sm group-hover:text-indigo-700">${prod.pd_codi}</span>
                            <span class="text-xs text-gray-400">Saldo: ${prod.pd_saldo}</span>
                        </div>
                        <div class="text-gray-800 text-xs truncate mt-0.5">${prod.pd_nome}</div>
                        ${detalhesTexto ? `<div class="text-gray-400 text-[10px] mt-0.5 uppercase">${detalhesTexto}</div>` : ''}
                    `;
                    
                    div.addEventListener('click', () => adicionarProduto(prod.pd_codi));
                    resultsContainer.appendChild(div);
                });
                resultsContainer.classList.remove('hidden');
            } else {
                resultsContainer.innerHTML = '<div class="p-3 text-sm text-gray-500 text-center">Nenhum produto encontrado.</div>';
                resultsContainer.classList.remove('hidden');
            }
        } catch (err) {
            console.error("Erro na busca:", err);
            resultsContainer.innerHTML = '<div class="p-3 text-sm text-red-500 text-center">Erro ao buscar produtos.</div>';
            resultsContainer.classList.remove('hidden');
        }
    }, 300);
}

async function adicionarProduto(codigo) {
    if (!currentEnderecoId) return;
    document.getElementById('resultados-busca').classList.add('hidden');
    document.getElementById('input-busca-produto').value = '';

    showLoader();
    try {
        const res = await fetch(`${API_BASE}/enderecos/${currentEnderecoId}/produtos`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${getToken()}` 
            },
            body: JSON.stringify({ codigo_produto: codigo })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Erro ao adicionar');
        }

        loadProdutosDoEndereco();
        loadEnderecos(); 

    } catch (err) {
        alert(err.message);
    } finally {
        hideLoader();
    }
}

window.removerProduto = async function(idMapa) {
    if(!confirm('Desvincular produto deste lote?')) return;
    
    showLoader();
    try {
        const res = await fetch(`${API_BASE}/produtos/${idMapa}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        
        if (res.ok) {
            loadProdutosDoEndereco();
            loadEnderecos();
        } else {
            alert('Erro ao remover produto.');
        }
    } catch(err) {
        console.error(err);
    } finally {
        hideLoader();
    }
};

// --- NOVA LÓGICA DE CONTAGEM ---

function toggleContagemModal(show) {
    const modal = document.getElementById('modal-contagem');
    if(show) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
    else { modal.classList.add('hidden'); modal.classList.remove('flex'); }
}

function openContagemModal() {
    if (!currentProductsList || currentProductsList.length === 0) {
        alert("Este lote está vazio. Adicione produtos antes de realizar a contagem.");
        return;
    }
    
    document.getElementById('modal-contagem-lote').textContent = `Lote: ${document.getElementById('lbl-codigo-endereco').textContent}`;
    document.getElementById('motivo-contagem').value = '';
    
    const tbody = document.getElementById('lista-contagem-items');
    tbody.innerHTML = '';

    currentProductsList.forEach(prod => {
        const tr = document.createElement('tr');
        tr.className = 'border-b hover:bg-gray-50';
        tr.dataset.codigo = prod.codigo;
        tr.dataset.qtdAnterior = prod.saldo;
        
        tr.innerHTML = `
            <td class="px-6 py-4 font-mono text-gray-600 font-medium">${prod.codigo}</td>
            <td class="px-6 py-4 text-gray-800">${prod.nome}</td>
            <td class="px-6 py-4 text-right font-bold text-gray-500">${prod.saldo}</td>
            <td class="px-6 py-3 text-center bg-indigo-50/30">
                <input type="number" step="0.001" value="${prod.saldo}" 
                       class="input-nova-qtd w-32 text-center border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 font-bold text-indigo-700 text-lg">
            </td>
        `;
        tbody.appendChild(tr);
    });

    toggleContagemModal(true);
}

async function saveContagem() {
    const motivo = document.getElementById('motivo-contagem').value;
    if (!motivo.trim()) {
        alert("Por favor, informe o motivo do ajuste (ex: Inventário, Conferência).");
        return;
    }

    const filial = document.getElementById('filial-select').value;
    const nomeLote = document.getElementById('lbl-codigo-endereco').textContent;
    const inputs = document.querySelectorAll('.input-nova-qtd');
    const itensParaAjuste = [];

    inputs.forEach(input => {
        const tr = input.closest('tr');
        const codigo = tr.dataset.codigo;
        const qtdAnterior = parseFloat(tr.dataset.qtdAnterior);
        const novaQtd = parseFloat(input.value);

        if (qtdAnterior !== novaQtd) {
            itensParaAjuste.push({
                codigo: codigo,
                qtdAnterior: qtdAnterior,
                novaQtd: novaQtd,
                lote: nomeLote
            });
        }
    });

    if (itensParaAjuste.length === 0) {
        alert("Nenhuma alteração de quantidade detectada.");
        return;
    }

    if (!confirm(`Confirma o ajuste de saldo para ${itensParaAjuste.length} itens?`)) return;

    showLoader();
    try {
        const res = await fetch(`${API_BASE}/ajuste-contagem`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify({
                filial: filial,
                motivoGeral: motivo,
                itens: itensParaAjuste
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        alert("Contagem processada com sucesso!");
        toggleContagemModal(false);
        loadProdutosDoEndereco(); // Recarrega saldos
    } catch (err) {
        alert("Erro ao processar contagem: " + err.message);
    } finally {
        hideLoader();
    }
}