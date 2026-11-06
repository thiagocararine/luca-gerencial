-- Tesouraria — Fechamento do Dia (fase 1)
-- Só mexe nas tabelas da tesouraria no banco GERENCIAL; nada no ERP (sei).
--
-- Rode manualmente (este projeto nao roda DDL automatico):
--   mysql -h <host> -u <user> -p gerencial_lucamat < migrations/2026-11-06_tesouraria_fechamento.sql

-- normal: entra no resultado do dia.
-- transferencia: dinheiro mudando de lugar (loja -> escritório, depósito do dinheiro das lojas).
-- fundo: controle interno do caixa da loja, que repõe no dia seguinte.
ALTER TABLE tesouraria_movimentos
    ADD COLUMN natureza ENUM('normal', 'transferencia', 'fundo') NOT NULL DEFAULT 'normal' AFTER tipo;

-- Nova origem: itens digitados no quadro "Caixa das lojas" do fechamento.
ALTER TABLE tesouraria_movimentos
    MODIFY origem ENUM('manual', 'despesa_caixa', 'erp_apagar', 'erp_receber', 'caixa_loja') NOT NULL DEFAULT 'manual';

-- Classificação aprendida por fornecedor: classificou uma vez, os próximos pagamentos já vêm classificados.
CREATE TABLE IF NOT EXISTS tesouraria_classificacao_fornecedor (
    chave VARCHAR(255) NOT NULL PRIMARY KEY,
    grupo_despesa VARCHAR(255) NOT NULL,
    tipo_despesa VARCHAR(255) NULL,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Fase 1: tudo entra numa conta geral.
INSERT INTO tesouraria_contas (nome, tipo, ordem)
SELECT 'Conta Geral', 'caixa_financeiro', -1
WHERE NOT EXISTS (SELECT 1 FROM tesouraria_contas WHERE nome = 'Conta Geral');
