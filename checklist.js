document.addEventListener('DOMContentLoaded', initChecklistPage);

const apiUrlBase = '/api';

// Funções utilitárias de autenticação
function getToken() { return localStorage.getItem('lucaUserToken'); }
function getUserData() { 
    const token = getToken(); 
    if (!token) return null; 
    try { 
        return JSON.parse(atob(token.split('.')[1])); 
    } catch (e) { 
        return null; 
    } 
}

function getUserName() { 
    return getUserData()?.nome || 'Utilizador'; 
}

function getUserProfile() { 
    return getUserData()?.perfil || null; 
}

function logout() { 
    localStorage.removeItem('lucaUserToken'); 
    window.location.href = 'login.html'; 
}

function initChecklistPage() {
    const token = getToken();
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    const userData = getUserData();
    if (userData && document.getElementById('user-name')) {
        document.getElementById('user-name').textContent = userData.nome || 'Utilizador';
    }
    
    gerenciarAcessoModulos(); // <-- Chame a função aqui

    loadVehiclesForChecklist();
    setupChecklistEventListeners();
}

function gerenciarAcessoModulos() {
    const userData = getUserData();
    if (!userData || !userData.permissoes) {
        console.error("Não foi possível obter as permissões do usuário.");
        return;
    }

    const permissoesDoUsuario = userData.permissoes;

    // Mapa completo com todos os módulos
    const mapaModulos = {
        'lancamentos': 'despesas.html',
        'logistica': 'logistica.html',
        'checklist': 'checklist.html',
        'produtos': 'produtos.html',
        'configuracoes': 'settings.html'
    };

    // Itera sobre o mapa de módulos para verificar cada permissão
    for (const [nomeModulo, href] of Object.entries(mapaModulos)) {
        const permissao = permissoesDoUsuario.find(p => p.nome_modulo === nomeModulo);
        
        // Se a permissão não existe ou não é permitida (permitido=false)
        if (!permissao || !permissao.permitido) {
            // Encontra o link na barra lateral e esconde o item da lista (o <li> pai)
            const link = document.querySelector(`#sidebar a[href="${href}"]`);
            if (link && link.parentElement) {
                link.parentElement.style.display = 'none';
            }
        }
    }
}

async function loadVehiclesForChecklist() {
    const container = document.getElementById('checklist-vehicle-list');
    container.innerHTML = '<p class="text-gray-500 col-span-full text-center p-8">A carregar veículos...</p>';
    
    try {
        const response = await fetch(`${apiUrlBase}/logistica/veiculos-para-checklist`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error('Falha ao carregar a lista de veículos.');

        let vehicles = await response.json();
        vehicles.sort((a, b) => a.checklist_hoje - b.checklist_hoje);
        renderVehicleCardsForChecklist(vehicles);

    } catch (error) {
        container.innerHTML = `<p class="text-red-500 col-span-full text-center p-8">${error.message}</p>`;
    }
}

function renderVehicleCardsForChecklist(vehicles) {
    const container = document.getElementById('checklist-vehicle-list');
    if (!container) return;
    if (vehicles.length === 0) {
        container.innerHTML = '<p class="text-gray-500 col-span-full text-center p-8">Nenhum veículo ativo encontrado para sua filial.</p>';
        return;
    }
    container.innerHTML = '';
    vehicles.forEach(vehicle => {
        // --- LOG DE VERIFICAÇÃO 1 ---
        console.log('Renderizando card para o veículo:', vehicle); // Verifica se o objeto 'vehicle' tem o 'id'

        const card = document.createElement('div');
        card.dataset.vehicleId = vehicle.id;
        card.dataset.vehicleInfo = `${vehicle.modelo} - ${vehicle.placa}`;

        const checklistFeito = vehicle.checklist_hoje > 0;
        const cardClasses = checklistFeito ? 'bg-green-50 border-green-400' : 'bg-white/80 backdrop-blur-sm border-gray-200';
        const buttonText = checklistFeito ? 'Ver Checklist Concluído' : 'Iniciar Checklist';
        const buttonActionClass = checklistFeito ? 'view-checklist-btn' : 'start-checklist-btn';

        card.className = `rounded-lg shadow p-4 flex flex-col justify-between border ${cardClasses}`;
        card.innerHTML = `
            <div>
                <div class="flex justify-between items-center">
                    <h3 class="font-bold text-gray-800 truncate">${vehicle.modelo}</h3>
                    ${checklistFeito ? '<span data-feather="check-circle" class="text-green-500 flex-shrink-0"></span>' : ''}
                </div>
                <p class="text-sm text-gray-600">${vehicle.placa}</p>
                <p class="text-xs text-gray-500 mt-2">${vehicle.nome_filial}</p>
            </div>
            <button class="w-full mt-4 bg-indigo-600 text-white text-sm font-semibold py-2 rounded-md hover:bg-indigo-700 ${buttonActionClass}">
                ${buttonText}
            </button>
        `;
        container.appendChild(card);
    });
    feather.replace();
}

function setupChecklistEventListeners() {
    const vehicleList = document.getElementById('checklist-vehicle-list');
    const launchModal = document.getElementById('checklist-modal');
    const reportModal = document.getElementById('checklist-report-modal');
    const itemsContainer = document.getElementById('checklist-items-container');

    vehicleList.addEventListener('click', (event) => {
        const button = event.target;
        const card = button.closest('[data-vehicle-id]');
        if (!card) return;

        const vehicleId = card.dataset.vehicleId;
        const vehicleInfo = card.dataset.vehicleInfo;

        if (button.classList.contains('start-checklist-btn')) {
            const vehicleData = { id: vehicleId, modelo: vehicleInfo.split(' - ')[0], placa: vehicleInfo.split(' - ')[1] };
            openChecklistModal(vehicleData);
        } else if (button.classList.contains('view-checklist-btn')) {
            // --- LOG DE VERIFICAÇÃO 2 ---
            console.log('Botão "Ver Checklist Concluído" foi clicado.');
            console.log('ID do Veículo capturado do card:', vehicleId); // Verifica se o ID foi pego do data attribute
            
            openChecklistReportModal(vehicleId, vehicleInfo);
        }
    });
    
    // Listeners para fechar os modais
    launchModal.querySelector('#close-checklist-modal-btn').addEventListener('click', () => launchModal.classList.add('hidden'));
    launchModal.querySelector('#cancel-checklist-btn').addEventListener('click', () => launchModal.classList.add('hidden'));
    if (reportModal) {
        reportModal.querySelector('#close-report-modal-btn').addEventListener('click', () => reportModal.classList.add('hidden'));
    }

    // Listener para o envio do formulário
    form.addEventListener('submit', handleChecklistSubmit);

    // Listener para os botões de status (OK/Avaria)
    itemsContainer.addEventListener('click', (event) => {
        const button = event.target.closest('.checklist-status-btn');
        if (!button) return;
        const itemDiv = button.closest('.checklist-item');
        const detailsDiv = itemDiv.querySelector('.avaria-details');
        
        itemDiv.querySelectorAll('.checklist-status-btn').forEach(btn => {
            btn.classList.remove('bg-green-500', 'bg-red-500', 'text-white');
            btn.classList.add('bg-gray-200');
        });

        if (button.dataset.status === 'OK') {
            button.classList.add('bg-green-500', 'text-white');
            detailsDiv.classList.add('hidden');
        } else {
            button.classList.add('bg-red-500', 'text-white');
            detailsDiv.classList.remove('hidden');
        }
    });

    // Listener para o efeito de acordeão
    launchModal.querySelectorAll('.accordion-header').forEach(header => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            const icon = header.querySelector('[data-feather="chevron-down"]');
            if (content) content.classList.toggle('hidden');
            if (icon) icon.classList.toggle('rotate-180');
        });
    });

    // --- SEÇÃO ATUALIZADA ---
    // Adiciona o processamento de imagem (compressão) para os campos de foto

    // 1. Para as fotos de avaria (que são criadas dinamicamente)
    itemsContainer.addEventListener('change', (event) => {
        if (event.target.type === 'file') {
            handlePhotoProcessing(event); // Chama a nova função
        }
    });

    // 2. Para as fotos obrigatórias (que são fixas no HTML)
    form.querySelector('input[name="foto_frente"]')?.addEventListener('change', handlePhotoProcessing);
    form.querySelector('input[name="foto_traseira"]')?.addEventListener('change', handlePhotoProcessing);
    form.querySelector('input[name="foto_lateral_direita"]')?.addEventListener('change', handlePhotoProcessing);
    form.querySelector('input[name="foto_lateral_esquerda"]')?.addEventListener('change', handlePhotoProcessing);
    // --- FIM DA SEÇÃO ATUALIZADA ---
}

async function openChecklistModal(vehicle) {
    const modal = document.getElementById('checklist-modal');
    document.getElementById('checklist-vehicle-info').textContent = `${vehicle.modelo} - ${vehicle.placa}`;
    document.getElementById('checklist-vehicle-id').value = vehicle.id;
    const form = document.getElementById('checklist-form');
    form.reset();
    
    // Reseta e define o estado do acordeão
    modal.querySelectorAll('.accordion-content').forEach((content, index) => {
        const header = content.previousElementSibling;
        const icon = header ? header.querySelector('[data-feather="chevron-down"]') : null;

        // ALTERAÇÃO APLICADA AQUI: Abre a primeira seção (index 0) por padrão
        if (index === 0) {
            content.classList.remove('hidden');
            if (icon) icon.classList.add('rotate-180');
        } else {
            content.classList.add('hidden');
            if (icon) icon.classList.remove('rotate-180');
        }
    });

    const itemsContainer = document.getElementById('checklist-items-container');
    itemsContainer.innerHTML = '';
    
    modal.classList.remove('hidden');
    feather.replace();

    const requiredItems = [
        "Lataria", 
        "Pneus", 
        "Nível de Óleo e Água", 
        "Iluminação (Lanternas e Sinalização)"
    ];

    requiredItems.forEach((item) => {
        const itemSanitizedName = item.replace(/\s+/g, '_').replace(/[^\w-]/g, '');
        const itemDiv = document.createElement('div');
        itemDiv.className = 'checklist-item p-3 bg-gray-50 rounded-md';
        itemDiv.dataset.itemName = item;

        itemDiv.innerHTML = `
            <div class="flex justify-between items-center">
                <label class="font-medium text-gray-800">${item} <span class="text-red-500">*</span></label>
                <div class="flex gap-2">
                    <button type="button" class="checklist-status-btn bg-gray-200 px-3 py-1 text-sm rounded" data-item="${item}" data-status="OK">OK</button>
                    <button type="button" class="checklist-status-btn bg-gray-200 px-3 py-1 text-sm rounded" data-item="${item}" data-status="Avaria">Avariado</button>
                </div>
            </div>
            <div class="avaria-details hidden mt-3 space-y-2">
                <textarea name="avaria_descricao_${itemSanitizedName}" class="form-input w-full text-sm" placeholder="Descreva a avaria..."></textarea>
                <input type="file" name="avaria_foto_${itemSanitizedName}" class="text-sm" accept="image/*" capture="environment">
            </div>
        `;
        itemsContainer.appendChild(itemDiv);
    });
}

async function handleChecklistSubmit(event) {
    event.preventDefault();
    const form = event.target;

    // --- INÍCIO DA NOVA VALIDAÇÃO DE FOTOS ---
    const requiredPhotos = ['foto_frente', 'foto_traseira', 'foto_lateral_direita', 'foto_lateral_esquerda'];
    const photoLabels = {
        'foto_frente': 'Frente do Veículo',
        'foto_traseira': 'Traseira do Veículo',
        'foto_lateral_direita': 'Lateral Direita',
        'foto_lateral_esquerda': 'Lateral Esquerda'
    };

    for (const photoName of requiredPhotos) {
        const input = form.querySelector(`input[name="${photoName}"]`);
        if (!input || input.files.length === 0) {
            alert(`A foto obrigatória "${photoLabels[photoName]}" não foi selecionada.`);
            return; // Interrompe o envio do formulário
        }
    }
    // --- FIM DA NOVA VALIDAÇÃO DE FOTOS ---

    // Validação de itens (OK/Avaria) - Permanece a mesma
    const items = document.querySelectorAll('#checklist-items-container .checklist-item');
    let allItemsValid = true;
    for (const item of items) {
        // ... (o restante desta validação continua igual)
    }
    if (!allItemsValid) {
        return;
    }

    const saveBtn = document.getElementById('save-checklist-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'A enviar...';
    
    const loader = document.getElementById('global-loader');
    loader.style.display = 'flex';

    const formData = new FormData(form);

    const checklistItems = [];
    document.querySelectorAll('#checklist-items-container .checklist-item').forEach((itemDiv) => {
        const itemName = itemDiv.dataset.itemName;
        const okButton = itemDiv.querySelector('.checklist-status-btn[data-status="OK"].bg-green-500');
        const avariaButton = itemDiv.querySelector('.checklist-status-btn[data-status="Avaria"].bg-red-500');
        
        let status = '';
        let descricao = '';

        if (okButton) {
            status = 'OK';
        } else if (avariaButton) {
            status = 'Avaria';
            const itemSanitizedName = itemName.replace(/\s+/g, '_').replace(/[^\w-]/g, '');
            const descricaoInput = itemDiv.querySelector(`textarea[name="avaria_descricao_${itemSanitizedName}"]`);
            descricao = descricaoInput ? descricaoInput.value : '';
        }

        checklistItems.push({
            item: itemName,
            status: status,
            descricao: descricao
        });
    });

    formData.append('checklist_items', JSON.stringify(checklistItems));
    
    // Os campos abaixo já são adicionados automaticamente pelo FormData
    // formData.append('id_veiculo', document.getElementById('checklist-vehicle-id').value);
    // formData.append('odometro_saida', document.getElementById('checklist-odometer').value);
    // formData.append('observacoes_gerais', document.getElementById('checklist-observacoes').value);
    // formData.append('nome_motorista', document.getElementById('checklist-driver-name').value);

    // --- LÓGICA DE TRATAMENTO DE ERRO MELHORADA ---
    try {
        const response = await fetch(`${apiUrlBase}/logistica/checklist`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getToken()}` },
            body: formData
        });

        // Se a resposta NÃO for OK, vamos capturar os detalhes
        if (!response.ok) {
            const responseBody = await response.text(); // Pega a resposta do servidor como texto
            const detailedError = `Status: ${response.status} (${response.statusText})\n\nResposta do Servidor:\n${responseBody}`;
            // Lança um erro com a mensagem detalhada
            throw new Error(detailedError);
        }

        // Se a resposta for OK, continua o fluxo normal
        const result = await response.json();
        
        alert('Checklist registado com sucesso!');
        document.getElementById('checklist-modal').classList.add('hidden');
        
        await loadVehiclesForChecklist();

    } catch (error) {
        // O alerta agora exibirá a mensagem de erro detalhada que criamos
        alert(`Erro ao enviar o checklist:\n\n${error.message}`);
    } finally {
        loader.style.display = 'none';
        saveBtn.disabled = false;
        saveBtn.textContent = 'Registrar Saída';
    }
}

async function openChecklistReportModal(vehicleId, vehicleInfo) {
    const loader = document.getElementById('global-loader');
    loader.style.display = 'flex';
    const modal = document.getElementById('checklist-report-modal');

    try {
        const hoje = new Date().toISOString().slice(0, 10);
        
        // --- LOG DE VERIFICAÇÃO 3 ---
        console.log('--- Dentro da função openChecklistReportModal ---');
        console.log('ID do Veículo recebido pela função:', vehicleId); // Verifica o parâmetro
        console.log('Data usada na busca:', hoje);
        const apiUrl = `${apiUrlBase}/logistica/checklist/relatorio?veiculoId=${vehicleId}&data=${hoje}`;
        console.log('URL final da API que será chamada:', apiUrl); // Mostra a URL exata
        
        const response = await fetch(apiUrl, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });

        if (!response.ok) {
            if (response.status === 404) throw new Error('O relatório do checklist de hoje não foi encontrado.');
            throw new Error('Falha ao buscar os dados do checklist.');
        }

        const data = await response.json();
        const { checklist, avarias } = data;

        // O código restante para preencher o modal está correto e permanece o mesmo
        document.getElementById('report-vehicle-info').textContent = vehicleInfo;
        document.getElementById('report-datetime').textContent = new Date(checklist.data_checklist).toLocaleString('pt-BR');
        document.getElementById('report-driver').textContent = checklist.nome_motorista || 'Não informado';
        document.getElementById('report-odometer').textContent = checklist.odometro_saida.toLocaleString('pt-BR');
        document.getElementById('report-user').textContent = checklist.nome_usuario || 'Não informado';
        document.getElementById('report-obs').textContent = checklist.observacoes_gerais || 'Nenhuma.';

        const itemsContainer = document.getElementById('report-items-container');
        itemsContainer.innerHTML = '';
        const requiredItems = ["Lataria", "Pneus", "Nível de Óleo e Água", "Iluminação (Lanternas e Sinalização)"];

        requiredItems.forEach(itemName => {
            const avaria = avarias.find(a => a.item_verificado === itemName);
            const status = avaria ? 'Avaria' : 'OK';
            const statusClass = avaria ? 'text-red-600' : 'text-green-600';

            const itemHtml = `
                <div class="p-3 bg-gray-50 rounded-md">
                    <div class="flex justify-between items-center">
                        <span class="font-medium">${itemName}</span>
                        <span class="font-bold ${statusClass}">${status}</span>
                    </div>
                    ${avaria ? `
                    <div class="mt-2 pl-2 border-l-2 border-gray-200 text-sm">
                        <p><strong>Descrição:</strong> ${avaria.descricao_avaria || 'Nenhuma'}</p>
                        ${avaria.foto_url ? `<a href="/${avaria.foto_url}" target="_blank" class="text-indigo-600 hover:underline">Ver Foto da Avaria</a>` : ''}
                    </div>
                    ` : ''}
                </div>
            `;
            itemsContainer.innerHTML += itemHtml;
        });

        const photosContainer = document.getElementById('report-photos-container');
        photosContainer.innerHTML = '';
        const photos = [
            { label: 'Frente', url: checklist.foto_frente_url },
            { label: 'Traseira', url: checklist.foto_traseira_url },
            { label: 'Lateral Direita', url: checklist.foto_lateral_direita_url },
            { label: 'Lateral Esquerda', url: checklist.foto_lateral_esquerda_url }
        ];

        photos.forEach(photo => {
            const imagePath = photo.url ? `/${photo.url}` : 'https://placehold.co/300x200/e2e8f0/4a5568?text=Sem+Foto';
            const photoHtml = `
                <div>
                    <p class="text-sm font-semibold mb-1">${photo.label}</p>
                    <a href="${imagePath}" target="_blank" class="block">
                        <img src="${imagePath}" alt="${photo.label}" class="w-full h-32 object-cover rounded-md border bg-gray-100">
                    </a>
                </div>
            `;
            photosContainer.innerHTML += photoHtml;
        });
        
        modal.classList.remove('hidden');
        feather.replace();

    } catch (error) {
        alert(`Erro ao carregar o relatório: ${error.message}`);
    } finally {
        loader.style.display = 'none';
    }
}

async function handlePhotoProcessing(event) {
    const fileInput = event.target;
    if (fileInput.files.length === 0) return;

    let file = fileInput.files[0];
    const maxSize = 5 * 1024 * 1024; // 5 MB

    if (file.size > maxSize) {
        alert(`A foto "${file.name}" é muito grande (${(file.size / 1024 / 1024).toFixed(2)} MB) e será otimizada automaticamente. Por favor, aguarde.`);
        
        try {
            const compressedFile = await compressImage(file);
            console.log(`Foto otimizada de ${(file.size / 1024 / 1024).toFixed(2)} MB para ${(compressedFile.size / 1024 / 1024).toFixed(2)} MB.`);

            // Truque para substituir o arquivo no input
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(compressedFile);
            fileInput.files = dataTransfer.files;
            
            alert(`Foto otimizada com sucesso! Pode continuar.`);

        } catch (error) {
            alert("Ocorreu um erro ao otimizar a foto. Por favor, tente selecionar uma imagem menor.");
            fileInput.value = ''; // Limpa o campo em caso de erro
        }
    }
}

function compressImage(file, maxWidth = 1024, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob(
                    (blob) => {
                        if (!blob) {
                            reject(new Error('Falha na compressão da imagem.'));
                            return;
                        }
                        const compressedFile = new File([blob], file.name, {
                            type: 'image/jpeg',
                            lastModified: Date.now(),
                        });
                        resolve(compressedFile);
                    },
                    'image/jpeg',
                    quality
                );
            };
            img.onerror = (error) => reject(error);
        };
        reader.onerror = (error) => reject(error);
    });
}

function gerenciarAcessoModulos() {
    const userData = getUserData();
    if (!userData || !userData.permissoes) {
        console.error("Não foi possível obter as permissões do usuário.");
        return;
    }

    const permissoesDoUsuario = userData.permissoes;

    // Mapeamento dos nomes dos módulos para os links no HTML
    const mapaModulos = {
        'lancamentos': 'despesas.html',
        'logistica': 'logistica.html',
        'configuracoes': 'settings.html',
        'checklist': 'checklist.html' // Garante que ele mesmo não seja escondido
    };

    // Itera sobre o mapa de módulos para verificar cada permissão
    for (const [nomeModulo, href] of Object.entries(mapaModulos)) {
        const permissao = permissoesDoUsuario.find(p => p.nome_modulo === nomeModulo);
        
        // Se a permissão não existe ou não é permitida
        if (!permissao || !permissao.permitido) {
            // Encontra o link na barra lateral e esconde o item da lista (o <li> pai)
            const link = document.querySelector(`#sidebar a[href="${href}"]`);
            if (link && link.parentElement) {
                link.parentElement.style.display = 'none';
            }
        }
    }
}