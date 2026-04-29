// impressao_a4.js

// ==========================================================
//               LAYOUT PADRÃO (ERP) PARA IMPRESSÕES A4
// ==========================================================
function getCabecalhoHtml(logoBase64) {
    return `
        <div style="display: flex; align-items: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 10px;">
            <div style="margin-right: 15px;">
                ${logoBase64 ? `<img src="${logoBase64}" style="max-width: 140px; max-height: 60px;">` : '<h2>LUCA</h2>'}
            </div>
            <div style="text-align: left; font-family: 'Helvetica', sans-serif;">
                <div style="font-size: 16px; font-weight: bold; margin-bottom: 3px;">LUCA MATERIAL DE CONSTRUCAO LTDA</div>
                <div style="font-size: 11px;">Av. Automovel Clube SN Qd 04 Lote 19 - Parada Angelica Duque De Caxias [RJ] CEP: 25272405</div>
                <div style="font-size: 11px;">CNPJ: 36.671.152/0004-06 | Tel(s): (21) 2778-3885 | 2739-1480 | 2675-7410</div>
            </div>
        </div>
    `;
}

function getCabecalhoDavHtml(logoBase64, dataEmissao, davNumber, paginaStr, isReceberLocal = false, clienteNome = '', clienteDoc = '') {
    const tagReceber = isReceberLocal ? ` <span style="background:#000; color:#fff; padding:2px 6px; font-size:10px; border-radius:3px;">{ Receber no Local }</span>` : '';
    return `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 5px; margin-bottom: 5px;">
        <div style="width: 120px;">
            ${logoBase64 ? `<img src="${logoBase64}" style="max-width: 100%; height: auto;">` : '<h2 style="margin:0;">LUCA</h2>'}
        </div>
        <div style="text-align: center; font-size: 11px; font-family: 'Courier New', Courier, monospace; line-height: 1.2; flex: 1;">
            <div style="font-weight: bold; font-size: 14px;">LUCA MATERIAL DE CONSTRUCAO LTDA</div>
            <div>Av Automovel Clube SN Qd 04 Lote 19</div>
            <div>Parada Angelica Duque De Caxias [RJ] CEP: 25272405</div>
            <div>CNPJ: 36.671.152/0004-06 ${tagReceber}</div>
            <div>Tel(s): (21) 2778-3885 | 2739-1480 | 2675-7410</div>
            <div style="margin-top: 5px; font-weight: bold; font-size: 13px;">DOCUMENTO AUXILIAR DE VENDA</div>
        </div>
        <div style="font-size: 10px; text-align: right; font-family: 'Courier New', Courier, monospace; line-height: 1.2; width: 130px;">
            <div>Emissão: ${dataEmissao}</div>
            <div>Pagina: ${paginaStr}</div>
            <div>Relatorio: DAV</div>
            <div style="margin-top: 10px; font-weight: bold; font-size: 12px;">Nº DAV: ${davNumber.toString().padStart(13, '0')}</div>
        </div>
    </div>
    <div style="font-size: 9px; font-weight: bold; text-align: center; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 4px 0; margin-bottom: 10px; font-family: 'Courier New', monospace;">
        NÃO É DOCUMENTO FISCAL, NÃO É VALIDO COMO RECIBO E COMO GARANTIA DE MERCADORIA, NÃO COMPROVA PAGAMENTO
    </div>
    <div style="font-size: 11px; margin-bottom: 5px;">
        <strong>NOME DO CLIENTE:</strong> ${clienteNome.toUpperCase()} <span style="float:right;"><strong>CPF-CNPJ:</strong> ${clienteDoc || 'Não informado'}</span>
    </div>
    `;
}

function getEstiloImpressao() {
    return `
    <style>
        @page { margin: 3mm; }
        body { font-family: 'Courier New', Courier, monospace; font-size: 10px; color: #000; padding: 0; margin: 0; line-height: 1.2; }
        table { width: 100%; border-collapse: collapse; margin-top: 5px; margin-bottom: 5px; font-size: 10px; }
        th, td { border: 1px solid #000; padding: 3px 2px; }
        th { background-color: transparent; text-align: center; text-transform: uppercase; font-weight: bold; font-size: 9px; }
        td { vertical-align: middle; }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .text-left { text-align: left; }
        .font-bold { font-weight: bold; }
        .page-break { page-break-after: always; }
        .endereco-entrega { border: 1px solid #000; padding: 5px; margin-top: 10px; font-size: 10px;}
        .totais-box { margin-top: 5px; font-size: 11px; display: flex; justify-content: space-between; padding: 5px; }
        .rodape-observacoes { font-size: 9px; margin-top: 10px; line-height: 1.2; }
        @media print { .no-print { display: none; } }
    </style>
    `;
}

// ==========================================================
//               IMPRESSÕES E RELATÓRIOS (PDF / HTML)
// ==========================================================
window.abrirDanfe = async function(chave) {
    showLoader();
    try {
        const res = await fetch(`${apiUrlBase}/entregas/danfe/${chave}`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!res.ok) throw new Error((await res.json()).error || "Erro ao carregar a Nota Fiscal.");
        
        const disposition = res.headers.get('Content-Disposition');
        let fileName = `NFe_${chave}.pdf`; 
        if (disposition && disposition.indexOf('filename=') !== -1) {
            const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
            if (matches != null && matches[1]) fileName = matches[1].replace(/['"]/g, ''); 
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none'; a.href = url; a.download = fileName; 
        document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(url); }, 100);
    } catch(e) { showToast(e.message, "error"); } finally { hideLoader(); }
}

window.imprimirEspelhoDav = async function(davNumber) {
    showLoader();
    try {
        const res = await fetch(`${apiUrlBase}/entregas/dav/${davNumber}`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        const data = await res.json();
        
        const logo = localStorage.getItem('company_logo') || '';
        const printWindow = window.open('', '_blank');
        const dataEmissao = data.data_hora_pedido ? new Date(data.data_hora_pedido).toLocaleString('pt-BR') : '';
        const isReceberLocal = (data.cobrar_local === '1' || data.cobrar_local === 'S' || data.cobrar_local === 'T' || data.status_caixa !== '1');

        let itensHtml = '';
        data.itens.forEach((i, index) => {
            const numItem = String(index + 1).padStart(3, '0');
            const fabricante = i.fabricante || i.it_fabr || i.pd_fabr || '';
            const endereco = i.endereco_prateleira || i.endereco || i.it_ende || i.pd_ende || '';
            
            const obsTexto = window.extrairObservacao(i.observacao || i.it_obsc);
            const infoAdicional = obsTexto ? `<br><span style="font-size:10px; font-style:italic; color:#333;">↳ ${obsTexto}</span>` : '';
            
            const qtd = parseFloat(i.quantidade_total || i.it_quan || 0).toFixed(2);
            const vlUnit = parseFloat(i.valor_unitario || i.it_prec || i.vl_unitario || 0).toFixed(2);
            const vlTot = parseFloat(i.valor_total_item || i.it_ctot || i.vl_total || 0).toFixed(2);
            const saldoRet = parseFloat(i.quantidade_saldo || 0).toFixed(2);
            
            itensHtml += `
                <tr>
                    <td class="text-center">${numItem}</td>
                    <td class="text-center">${window.limpaCod(i.pd_codi)}</td>
                    <td class="text-left"><b>${i.pd_nome}</b>${infoAdicional}</td>
                    <td class="text-center">${i.unidade}</td>
                    <td class="text-center">${qtd}</td>
                    <td class="text-right">${vlUnit}</td>
                    <td class="text-right">${vlTot}</td>
                    <td style="font-size: 9px; text-align:center;">${fabricante}</td>
                    <td style="font-size: 9px; text-align:center;">${endereco}</td>
                    <td class="text-center font-bold">${saldoRet}</td>
                </tr>
            `;
        });

        let html = `
        <html>
        <head>
            <title>DAV #${davNumber}</title>
            ${getEstiloImpressao()}
        </head>
        <body>
            <div class="no-print" style="margin-bottom: 20px; text-align: center;">
                <button onclick="window.print()" style="padding: 10px 20px; background: #4f46e5; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;">Imprimir Espelho DAV</button>
            </div>
            
            ${getCabecalhoDavHtml(logo, dataEmissao, davNumber, '001 [001]', isReceberLocal, data.cliente.nome, data.cliente.doc)}

            <table>
                <thead>
                    <tr>
                        <th width="4%">ITEM</th>
                        <th width="9%">ID-CÓDIGO</th>
                        <th width="28%" class="text-left">DESCRIÇÃO DOS PRODUTOS</th>
                        <th width="4%">UN</th>
                        <th width="8%">QUANTIDADE</th>
                        <th width="9%" class="text-right">VL.UNITÁRIO</th>
                        <th width="9%" class="text-right">VALOR TOTAL</th>
                        <th width="10%">FABRICANTE</th>
                        <th width="10%">ENDEREÇO</th>
                        <th width="9%">SALDO A RETIRAR</th>
                    </tr>
                </thead>
                <tbody>${itensHtml}</tbody>
            </table>

            <div class="endereco-entrega">
                <div class="font-bold" style="margin-bottom: 5px;">[ ENDEREÇO DE ENTREGA ]</div>
                <div>${window.formatarEnderecoCompleto(data.endereco.logradouro)}</div>
                <div>Bairro: ${data.endereco.bairro || '-'} &nbsp;|&nbsp; Cidade: ${data.endereco.cidade || '-'} &nbsp;|&nbsp; CEP: ${data.endereco.cep || '-'}</div>
                <div style="margin-top: 5px;"><strong>Referência:</strong> ${data.endereco.referencia || '-'}</div>
            </div>

            <div class="totais-box">
                <div><strong>VENDEDOR:</strong> ${data.vendedor || 'N/I'}</div>
                <div><strong>TOTAL DO DAV:</strong> R$ ${parseFloat(data.valor_total).toLocaleString('pt-BR', {minimumFractionDigits:2})}</div>
            </div>

            <div class="rodape-observacoes">
                - DEVOLUCAO/DESISTENCIA SOMENTE NA DATA DA COMPRA.<br>
                - NAO REALIZAMOS TROCA DE MERCADORIA ADQUIRIDA EM LOJA FISICA EXCETO, COMPROVADO DEFEITO DE FABRICACAO E COM A NOTA.<br>
                - NAO AGENDAMOS HORARIO DE ENTREGA, E NAO GUARDAMOS PEDIDOS!!<br>
                - ATENCAO: NAO GUARDAMOS TIJOLOS, POR FAVOR NAO INSISTA.<br>
                - ENTREGAS DE SEGUNDA A SABADO DE 8H as 18HRS.
            </div>
            
            <div style="margin-top: 60px; text-align: center; width: 80%; margin-left: auto; margin-right: auto; padding-top: 10px; font-weight: bold;">
                _________________________________________________________________________________<br>
                Assinatura do Cliente / Ciente e de acordo com o recebimento
            </div>
        </body>
        </html>`;
        
        printWindow.document.write(html);
        printWindow.document.close();
        setTimeout(() => printWindow.print(), 500);

    } catch (e) { showToast("Erro ao gerar impressão.", "error"); } finally { hideLoader(); }
};

window.imprimirPedidosCarga = async function(romaneioId) {
    showLoader();
    try {
        const res = await fetch(`${apiUrlBase}/entregas/romaneios/${romaneioId}`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        const romaneioData = await res.json();

        const davsUnicos = [...new Set(romaneioData.itens.map(i => i.dav_numero))];
        const davsPromises = davsUnicos.map(davNum => fetch(`${apiUrlBase}/entregas/dav/${davNum}`, { headers: { 'Authorization': `Bearer ${getToken()}` } }).then(r => r.json()));
        const davsCompletos = await Promise.all(davsPromises);

        const logo = localStorage.getItem('company_logo') || '';
        const printWindow = window.open('', '_blank');

        let html = `<html><head><title>DAVs da Carga #${romaneioId}</title>${getEstiloImpressao()}</head><body>
        <div class="no-print" style="margin-bottom: 20px; text-align: center;">
            <button onclick="window.print()" style="padding: 10px 20px; background: #10b981; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;">Imprimir Todos os DAVs (Lote)</button>
        </div>`;

        davsCompletos.forEach((data, idx) => {
            const isReceberLocal = (data.cobrar_local === '1' || data.cobrar_local === 'S' || data.cobrar_local === 'T' || data.status_caixa !== '1');

            let itensHtml = '';
            data.itens.forEach((i, index) => {
                const itemNoRomaneio = romaneioData.itens.find(ri => String(ri.idavs_regi) === String(i.idavs_regi));
                let qtdNestaCarga = itemNoRomaneio ? parseFloat(itemNoRomaneio.quantidade_a_entregar) : 0;
                
                let saldoBanco = parseFloat(i.quantidade_saldo || 0);
                let saldoParaEntregarExibicao = saldoBanco + qtdNestaCarga;

                const numItem = String(index + 1).padStart(3, '0');
                const fabricante = i.fabricante || i.it_fabr || i.pd_fabr || '';
                const endereco = i.endereco_prateleira || i.endereco || i.it_ende || i.pd_ende || '';
                
                const obsTexto = window.extrairObservacao(i.observacao || i.it_obsc);
                const infoAdicional = obsTexto ? `<br><span style="font-size:10px; font-style:italic; color:#333;">↳ ${obsTexto}</span>` : '';
                
                const qtd = parseFloat(i.quantidade_total || i.it_quan || 0).toFixed(2);
                const vlUnit = parseFloat(i.valor_unitario || i.it_prec || i.vl_unitario || 0).toFixed(2);
                const vlTot = parseFloat(i.valor_total_item || i.it_ctot || i.vl_total || 0).toFixed(2);

                itensHtml += `
                    <tr>
                        <td class="text-center">${numItem}</td>
                        <td class="text-center">${window.limpaCod(i.pd_codi)}</td>
                        <td class="text-left"><b>${i.pd_nome}</b>${infoAdicional}</td>
                        <td class="text-center">${i.unidade}</td>
                        <td class="text-center">${qtd}</td>
                        <td class="text-right">${vlUnit}</td>
                        <td class="text-right">${vlTot}</td>
                        <td style="font-size: 8px; text-align:center;">${fabricante}</td>
                        <td style="font-size: 8px; text-align:center;">${endereco}</td>
                        <td class="text-center font-bold">${saldoParaEntregarExibicao.toFixed(2)}</td>
                    </tr>
                `;
            });

            const dataEmissao = data.data_hora_pedido ? new Date(data.data_hora_pedido).toLocaleString('pt-BR') : '';
            const pageStr = `${String(idx + 1).padStart(3, '0')} [${String(davsCompletos.length).padStart(3, '0')}]`;

            html += `
            <div class="${idx < davsCompletos.length - 1 ? 'page-break' : ''}">
                ${getCabecalhoDavHtml(logo, dataEmissao, data.dav_numero, pageStr, isReceberLocal, data.cliente.nome, data.cliente.doc)}

                <table>
                    <thead>
                        <tr>
                            <th width="4%">Item</th>
                            <th width="10%">ID-Código</th>
                            <th width="28%" class="text-left">Descrição dos Produtos</th>
                            <th width="4%">UN</th>
                            <th width="8%">Quantidade</th>
                            <th width="9%" class="text-right">Vl.Unitário</th>
                            <th width="9%" class="text-right">Valor Total</th>
                            <th width="12%">Referência/Fabricante</th>
                            <th width="8%">Endereço</th>
                            <th width="8%">TB Saldo a retirar</th>
                        </tr>
                    </thead>
                    <tbody>${itensHtml}</tbody>
                </table>

                <div class="endereco-entrega">
                    <div class="font-bold" style="margin-bottom: 5px;">[ ENDEREÇO DE ENTREGA ]</div>
                    <div>${window.formatarEnderecoCompleto(data.endereco.logradouro)}</div>
                    <div>Bairro: ${data.endereco.bairro || '-'} &nbsp;|&nbsp; Cidade: ${data.endereco.cidade || '-'} &nbsp;|&nbsp; CEP: ${data.endereco.cep || '-'}</div>
                    <div style="margin-top: 5px;"><strong>Referência:</strong> ${data.endereco.referencia || '-'}</div>
                </div>

                <div class="totais-box">
                    <div><strong>VENDEDOR:</strong> ${data.vendedor || 'N/I'}</div>
                    <div><strong>TOTAL DO DAV:</strong> R$ ${parseFloat(data.valor_total).toLocaleString('pt-BR', {minimumFractionDigits:2})}</div>
                </div>

                <div class="rodape-observacoes">
                    - DEVOLUCAO/DESISTENCIA SOMENTE NA DATA DA COMPRA.<br>
                    - NAO REALIZAMOS TROCA DE MERCADORIA ADQUIRIDA EM LOJA FISICA EXCETO, COMPROVADO DEFEITO DE FABRICACAO E COM A NOTA.<br>
                    - NAO AGENDAMOS HORARIO DE ENTREGA, E NAO GUARDAMOS PEDIDOS!!<br>
                    - ATENCAO: NAO GUARDAMOS TIJOLOS, POR FAVOR NAO INSISTA.<br>
                    - ENTREGAS DE SEGUNDA A SABADO DE 8H as 18HRS.
                </div>
                
                <div style="margin-top: 60px; text-align: center; width: 80%; margin-left: auto; margin-right: auto; padding-top: 10px; font-weight: bold;">
                    _________________________________________________________________________________<br>
                    Assinatura do Cliente / Ciente e de acordo com o recebimento
                </div>
            </div>`;
        });

        html += `</body></html>`;
        printWindow.document.write(html);
        printWindow.document.close();
        setTimeout(() => printWindow.print(), 800); 

    } catch (e) { showToast("Erro ao gerar lote de DAVs.", "error"); } finally { hideLoader(); }
};

window.imprimirRoteiro = async function(romaneioId) {
    showLoader();
    try {
        const res = await fetch(`${apiUrlBase}/entregas/romaneios/${romaneioId}`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        const data = await res.json();
        
        const printWindow = window.open('', '_blank');
        const logo = localStorage.getItem('company_logo') || '';
        
        const grouped = data.itens.reduce((acc, item) => {
            if(!acc[item.dav_numero]) {
                acc[item.dav_numero] = { 
                    dav_numero: item.dav_numero, cliente: item.cliente_nome, 
                    logradouro: item.logradouro || '', bairro: item.bairro || 'Sem Bairro', 
                    cidade: item.cidade || '', ref: item.referencia || '', tel: item.telefone || '',
                    itens: [],
                    isReceberLocal: false
                };
            }
            acc[item.dav_numero].itens.push(item);
            
            if (item.cobrar_local === '1' || item.cobrar_local === 'S' || item.cobrar_local === 'T' || item.cr_rloc === 'S') {
                acc[item.dav_numero].isReceberLocal = true;
            }
            
            return acc;
        }, {});
        
        const davsArray = Object.values(grouped).sort((a,b) => a.bairro.localeCompare(b.bairro));

        let html = `
        <html>
        <head>
            <title>Roteiro de Carga #${data.id}</title>
            <style>
                @page { margin: 5mm; }
                body { font-family: 'Helvetica', 'Arial', sans-serif; font-size: 11px; color: #000; padding: 0; margin: 0; line-height: 1.4; }
                .doc-title { font-size: 14px; font-weight: bold; margin: 10px 0; text-align: center; text-transform: uppercase; }
                .row-between { display: flex; justify-content: space-between; margin-bottom: 5px; }
                .dav-box { border: 1px solid #000; margin-bottom: 15px; page-break-inside: avoid; }
                .dav-header { background-color: #f3f4f6; padding: 6px; font-weight: bold; border-bottom: 1px solid #000; display: flex; justify-content: space-between; align-items: center;}
                .dav-address { padding: 6px; border-bottom: 1px solid #000; font-size: 10px; }
                table { width: 100%; border-collapse: collapse; }
                th { border-bottom: 1px solid #000; text-align: left; padding: 4px; font-size: 10px; text-transform: uppercase; }
                td { border-bottom: 1px dotted #ccc; padding: 4px; font-size: 11px; vertical-align: top;}
                .text-center { text-align: center; }
                .sig-box { padding: 25px 10px 10px 10px; text-align: right; border-top: 1px solid #000; font-weight: bold; }
                @media print { .no-print { display: none; } }
            </style>
        </head>
        <body>
            <div class="no-print" style="margin-bottom: 15px; text-align: center;">
                <button onclick="window.print()" style="padding: 10px 20px; background: #4f46e5; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;">Imprimir Roteiro</button>
            </div>
            
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 15px;">
                <div style="width: 140px;">
                    ${logo ? `<img src="${logo}" style="max-width: 100%; height: auto;">` : '<h2>LUCA</h2>'}
                </div>
                <div style="text-align: right; font-family: 'Helvetica', sans-serif;">
                    <div style="font-size: 16px; font-weight: bold; margin-bottom: 3px;">LUCA MATERIAL DE CONSTRUCAO LTDA</div>
                    <div style="font-size: 11px;">CNPJ: 36.671.152/0004-06 | Tel(s): (21) 2778-3885 | 2739-1480 | 2675-7410</div>
                </div>
            </div>
            
            <div class="doc-title">ROTEIRO DE CARGA #${data.id}</div>
            
            <div class="row-between" style="border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 15px;">
                <div><strong>Data Fechamento:</strong> ${new Date(data.data_criacao).toLocaleString('pt-BR')} &nbsp;|&nbsp; <strong>Origem:</strong> ${data.filial_origem}</div>
                <div><strong>Motorista:</strong> ${data.nome_motorista} &nbsp;|&nbsp; <strong>Veículo:</strong> ${data.modelo_veiculo} (${data.placa_veiculo})</div>
            </div>`;
            
        davsArray.forEach(dav => {
            const tagReceber = dav.isReceberLocal ? `<span style="background:#000; color:#fff; padding:3px 6px; font-size:10px; border-radius:3px; margin-left:8px;">RECEBER NO LOCAL</span>` : '';
            
            html += `
            <div class="dav-box">
                <div class="dav-header">
                    <span style="display:flex; align-items:center;">DAV #${dav.dav_numero.toString().padStart(13, '0')} - CLIENTE: ${dav.cliente.toUpperCase()} ${tagReceber}</span>
                    <span>BAIRRO: ${dav.bairro.toUpperCase()}</span>
                </div>
                <div class="dav-address">
                    <strong>ENDEREÇO:</strong> ${window.formatarEnderecoCompleto(dav.logradouro)}, ${dav.bairro} - ${dav.cidade}<br>
                    <strong>REF:</strong> ${dav.ref} &nbsp;&nbsp;|&nbsp;&nbsp; <strong>TEL:</strong> ${dav.tel}
                </div>
                <table>
                    <tr>
                        <th width="15%" class="text-center">ID-CÓDIGO</th>
                        <th width="60%">DESCRIÇÃO DO PRODUTO</th>
                        <th width="10%" class="text-center">UN</th>
                        <th width="15%" class="text-center">QTD A ENTREGAR</th>
                    </tr>
                    ${dav.itens.map(i => {
                        const obsDescodificada = window.extrairObservacao(i.observacao || i.it_obsc);
                        const obsRoteiro = obsDescodificada ? `<br><span style="font-size:10px; font-style:italic; color:#333;">↳ ${obsDescodificada}</span>` : '';
                        
                        // DEVOLUÇÃO no Roteiro
                        const qtdDevolvida = parseFloat(i.quantidade_devolvida || i.devolvido || i.it_qtdv || 0);
                        const tagDev = qtdDevolvida > 0 ? `<br><span style="color:#dc2626; font-size:10px; font-weight:bold;">[ ATENÇÃO: DEVOLUÇÃO DE ${qtdDevolvida} UN ]</span>` : '';
                        
                        return `
                        <tr>
                            <td class="text-center">${window.limpaCod(i.produto_codigo)}</td>
                            <td>${i.produto_nome}${obsRoteiro}${tagDev}</td>
                            <td class="text-center">${i.produto_unidade}</td>
                            <td class="text-center font-bold" style="font-size: 13px;">${parseFloat(i.quantidade_a_entregar)}</td>
                        </tr>`;
                    }).join('')}
                </table>
                <div class="sig-box">
                    DATA: ___/___/_______ &nbsp;&nbsp;&nbsp;&nbsp; ASSINATURA CLIENTE: _________________________________________
                </div>
            </div>`;
        });
        
        html += `</body></html>`;
        printWindow.document.write(html);
        printWindow.document.close();
        setTimeout(() => printWindow.print(), 500);

    } catch (e) { showToast("Erro ao gerar roteiro.", "error"); } finally { hideLoader(); }
};