-- Tesouraria — Fase B: importar titulos do Contas a Pagar (ERP, somente leitura)
-- Nada aqui toca o banco do ERP (sei). So guarda, no gerencial, de/para que permitem
-- sugerir automaticamente o centro de custo e a conta de cada titulo importado.
--
-- Rode com:
--   node migrations/run.js migrations/2026-11-04b_tesouraria_importacao_erp.sql

-- Codigos da "Indicacao de Pagamento" (apagar.ap_pagame) que pertencem a cada centro de
-- custo, separados por virgula. Dentro/Fora nao importa para a tesouraria.
ALTER TABLE tesouraria_centros_custo
    ADD COLUMN indicacoes_erp VARCHAR(50) NULL AFTER id_filial;

UPDATE tesouraria_centros_custo SET indicacoes_erp = '1,3' WHERE nome = 'Parada Angelica';
UPDATE tesouraria_centros_custo SET indicacoes_erp = '4,7' WHERE nome = 'Nova Campinas';
UPDATE tesouraria_centros_custo SET indicacoes_erp = '5,8' WHERE nome = 'Santa Cruz';
UPDATE tesouraria_centros_custo SET indicacoes_erp = '6,9' WHERE nome = 'Piabeta';
UPDATE tesouraria_centros_custo SET indicacoes_erp = '10' WHERE nome = 'Mendes dos Santos';
UPDATE tesouraria_centros_custo SET indicacoes_erp = '11' WHERE nome = 'Transportadora';

-- De/para da conta de pagamento escrita no ERP (apagar.ap_fpagam) para a conta da
-- tesouraria. A chave e o texto ja normalizado (maiusculas, sem acento, sem "PG " no
-- inicio): banco + numero da conta nas linhas de banco, ou o texto livre nas demais.
-- Novas chaves sao gravadas na primeira importacao em que o usuario escolhe a conta.
CREATE TABLE IF NOT EXISTS tesouraria_contas_erp (
    chave VARCHAR(150) NOT NULL PRIMARY KEY,
    id_conta INT NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tescontaerp_conta FOREIGN KEY (id_conta) REFERENCES tesouraria_contas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO tesouraria_contas_erp (chave, id_conta)
    SELECT 'BANCO SANTANDER (LUCAMAT) 130016412', id FROM tesouraria_contas WHERE nome = 'Banco Santander (LucaMaterial)';
INSERT IGNORE INTO tesouraria_contas_erp (chave, id_conta)
    SELECT 'PAGBANK ZE', id FROM tesouraria_contas WHERE nome = 'Pag Bank (Zeletrica)';
INSERT IGNORE INTO tesouraria_contas_erp (chave, id_conta)
    SELECT 'ITAU ZE', id FROM tesouraria_contas WHERE nome = 'Itau (Zeletrica)';
