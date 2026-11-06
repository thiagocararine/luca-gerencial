-- Caixa das lojas no fechamento + despesas das lojas repaginadas + limpeza aprovada pelo Thiago (07/11/2026).
-- Só mexe no banco GERENCIAL; nada no ERP (sei).
--
-- Rode manualmente (este projeto nao roda DDL automatico):
--   mysql -h <host> -u <user> -p gerencial_lucamat < migrations/2026-11-07_caixa_lojas.sql

-- --- DESPESAS DAS LOJAS ---

-- despesa: gasto pago com o dinheiro do caixa da loja.
-- retirada: dinheiro que o financeiro tirou do caixa (não é gasto da loja).
-- Combustível: veículo abastecido (vai para o relatório de abastecimento), litros e KM opcionais.
ALTER TABLE despesa_caixa
    ADD COLUMN dsp_natureza ENUM('despesa', 'retirada') NOT NULL DEFAULT 'despesa' AFTER dsp_status,
    ADD COLUMN id_veiculo INT NULL AFTER dsp_valordsp,
    ADD COLUMN litros DECIMAL(10, 2) NULL AFTER id_veiculo,
    ADD COLUMN odometro INT NULL AFTER litros,
    ADD INDEX idx_despesa_data_filial (dsp_datadesp, dsp_filial),
    ADD INDEX idx_despesa_veiculo (id_veiculo);

-- As lojas já lançavam a retirada do financeiro como "Pag. Boletos / FINANCEIRO".
UPDATE despesa_caixa
SET dsp_natureza = 'retirada'
WHERE dsp_grupo IN ('Pag. Boletos', 'Pag. Boleto')
  AND UPPER(TRIM(dsp_descricao)) LIKE 'FINANCEIRO%';

-- Datas digitadas erradas (1906, 0262, 2029, 05/12/2026): usa a data em que foram lançadas.
UPDATE despesa_caixa SET dsp_datadesp = dsp_datalanc WHERE ID IN (14840, 15256, 17544, 18396);

-- Nome da filial gravado com acento quebrado.
UPDATE despesa_caixa SET dsp_filial = 'Escritório (Lojas)' WHERE ID IN (19662, 19663, 19664);

-- --- CAIXA DAS LOJAS NO FECHAMENTO ---

-- Por loja e dia: quanto o financeiro quer retirar e, quando contado, o dinheiro que havia
-- no caixa no início do dia (reinicia o saldo acumulado "fundo de ontem").
CREATE TABLE IF NOT EXISTS tesouraria_caixa_loja_dia (
    data_movimento DATE NOT NULL,
    cod_filial VARCHAR(10) NOT NULL,
    a_retirar DECIMAL(12, 2) NULL,
    saldo_contado DECIMAL(12, 2) NULL,
    observacao VARCHAR(255) NULL,
    id_usuario INT NULL,
    nome_usuario VARCHAR(255) NULL,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (data_movimento, cod_filial)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --- LIMPEZA ---

-- Lançamentos de teste da tesouraria (04 a 06/11). Cadastros (contas, centros, grupos, tipos) ficam.
UPDATE tesouraria_movimentos SET id_movimento_estornado = NULL;
DELETE FROM tesouraria_movimentos;
DELETE FROM tesouraria_classificacao_fornecedor;

-- Origem "caixa_loja" nunca foi usada: o caixa das lojas lê a despesa_caixa direto.
ALTER TABLE tesouraria_movimentos
    MODIFY origem ENUM('manual', 'despesa_caixa', 'erp_apagar', 'erp_receber') NOT NULL DEFAULT 'manual';

-- Tabela vazia e sem uso no código.
DROP TABLE IF EXISTS viagens_despesas;
