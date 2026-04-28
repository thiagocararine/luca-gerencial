// impressao_termica.js

function formatarDataHora(dataISO) {
    if (!dataISO) return '';
    const d = new Date(dataISO);
    return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR')}`;
}

function limpaCod(cod) {
    return cod ? cod.toString().replace(/^0+(?=\d)/, '') : '';
}

window.imprimirCupomTermico = async function(davNumber) {
    showLoader();
    try {
        // Aproveitamos a mesma rota que já está perfeita e com todos os dados!
        const res = await fetch(`${apiUrlBase}/entregas/dav/${davNumber}`, { 
            headers: { 'Authorization': `Bearer ${getToken()}` } 
        });
        
        if (!res.ok) throw new Error("Erro ao buscar dados para a impressora térmica.");
        const data = await res.json();

        const printWindow = window.open('', '_blank', 'width=400,height=600');
        
        const dataEmissao = data.data_hora_pedido ? formatarDataHora(data.data_hora_pedido) : '';
        const dataImpressao = formatarDataHora(new Date().toISOString());
        const tracos = `------------------------------------------------`; // 48 caracteres (padrão 80mm)

        let itensHtml = '';
        data.itens.forEach((i) => {
            const cod = limpaCod(i.pd_codi);
            const qtd = parseFloat(i.quantidade_total || 0).toFixed(2);
            const vlUnit = parseFloat(i.valor_unitario || 0).toFixed(2);
            const vlTot = parseFloat(i.valor_total_item || 0).toFixed(2);
            const endereco = i.endereco_prateleira || '';
            const obsTexto = i.observacao || '';

            itensHtml += `
<div style="margin-bottom: 5px;">
    <div>${cod} ${i.pd_nome}</div>
    <div style="display: flex; justify-content: space-between; padding-left: 10px;">
        <span>${qtd} ${i.unidade} X</span>
        <span>${vlUnit}</span>
        <span>${vlTot}</span>
    </div>
    ${endereco ? `<div>Endereco: ${endereco}</div>` : ''}
    ${obsTexto ? `<div>OBS: ${obsTexto}</div>` : ''}
</div>`;
        });

        // HTML focado na formatação ESC/POS via CSS
        const html = `
        <html>
        <head>
            <title>Cupom DAV #${davNumber}</title>
            <style>
                @page { margin: 0; size: 80mm auto; }
                body { 
                    font-family: 'Courier New', Courier, monospace; 
                    font-size: 11px; 
                    color: #000; 
                    width: 76mm; 
                    margin: 0 auto; 
                    padding: 4mm 2mm;
                    line-height: 1.2;
                    text-transform: uppercase;
                }
                .center { text-align: center; }
                .right { text-align: right; }
                .bold { font-weight: bold; }
                .linha-pontilhada { border-top: 1px dashed #000; margin: 6px 0; width: 100%; }
                .linha-texto { overflow: hidden; white-space: nowrap; }
                .info-linha { margin-bottom: 2px; display: flex; }
                .info-linha span:first-child { min-width: 65px; }
            </style>
        </head>
        <body>
            <div class="center bold" style="margin-bottom: 5px; font-size: 12px; letter-spacing: 2px;">
                R E I M P R E S S A O
            </div>
            
            <div class="center" style="margin-bottom: 10px;">
                MATERIAL DE CONSTRUCAO LTDA<br>
                36.671.152/0001-63<br>
                RUA 15 SN QD93 LT09<br>
                NOVA CAMPINAS DUQUE DE CAXIAS RJ<br>
                CEP: 25268-430 TEL: (21) 2778-3885
            </div>

            <div class="linha-pontilhada"></div>

            <div class="info-linha"><span>Hoje....:</span> ${dataImpressao}</div>
            <div class="info-linha"><span>Emissao.:</span> ${dataEmissao}</div>
            <div class="info-linha"><span>Vendedor:</span> ${data.vendedor || 'N/I'}</div>
            <div class="info-linha"><span>CPF/CNPJ:</span> ${data.cliente.doc || 'N/I'}</div>
            <div class="info-linha"><span>Nome....:</span> ${data.cliente.nome}</div>
            
            <div class="linha-pontilhada"></div>
            
            <div class="center bold" style="margin-bottom: 5px;">
                Codigo-Descricao dos Produtos<br>
                Quantidade UN  Valor Unitario  Valor Total
            </div>

            <div class="linha-pontilhada"></div>

            ${itensHtml}

            <div class="linha-pontilhada"></div>
            
            <div style="margin-top: 5px;">
                Pedido No: ${davNumber.toString().padStart(13, '0')} ${dataEmissao}
            </div>
            
            <div style="display: flex; justify-content: space-between; margin-top: 5px;" class="bold">
                <span>Valor Total:</span>
                <span>${parseFloat(data.valor_total).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
            </div>

            <div class="linha-pontilhada"></div>
            
            <div style="margin: 5px 0;">
                { Formas de Pagamentos }<br>
                ${data.cobrar_local ? '12-Receber no Local' : 'Pagamento via Caixa'}
                <div class="right bold">${parseFloat(data.valor_total).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</div>
            </div>

            <div class="center" style="margin-top: 15px;">
                * Lykos Solucoes em TI *<br>
                Previsao para entrega: ${data.data_agendada ? new Date(data.data_agendada).toLocaleDateString('pt-BR') : 'N/I'}
            </div>

            <div class="linha-pontilhada"></div>

            <div class="center" style="font-size: 9px; margin-top: 10px; line-height: 1.1;">
                -DEVOLUCAO/DESISTENCIA SOMENTE NA DATA DA COMPRA.<br>
                -NAO REALIZAMOS TROCA DE MERCADORIA ADQUIRIDA EM LOJA FISICA EXCETO, COMPROVADO DEFEITO DE FABRICACAO E COM A NOTA.<br>
                -NAO AGENDAMOS HORARIO DE ENTREGA, E NAO GUARDAMOS PEDIDOS!!<br>
                -ATENCAO: NAO GUARDAMOS TIJOLOS, POR FAVOR NAO INSISTA.<br>
                -ENTREGAS DE SEGUNDA A SABADO DE 8H as 18HRS.
            </div>
            
            <div style="margin-top: 20px; text-align: center; border-top: 1px solid #000; padding-top: 5px; font-weight: bold;">
                Assinatura do Cliente
            </div>

        </body>
        </html>`;

        printWindow.document.write(html);
        printWindow.document.close();
        
        // Timeout ligeiramente maior para garantir o carregamento da fonte monospace no pop-up
        setTimeout(() => {
            printWindow.print();
        }, 800);

    } catch (error) {
        showToast(error.message, "error");
    } finally {
        hideLoader();
    }
};