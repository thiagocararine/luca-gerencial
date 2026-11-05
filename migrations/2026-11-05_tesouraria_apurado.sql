-- Tesouraria — Apurado das lojas
-- Entradas do apurado por loja e modalidade, puxadas do ERP (Contas a Receber, só leitura).
-- Só mexe nas tabelas da tesouraria no banco GERENCIAL; nada no ERP (sei).
--
-- Rode manualmente (este projeto nao roda DDL automatico):
--   mysql -h <host> -u <user> -p gerencial_lucamat < migrations/2026-11-05_tesouraria_apurado.sql

-- Nova origem: lançamentos vindos do apurado do ERP.
-- origem_ref = 'AAAA-MM-DD|FILIAL|modalidade' (entrada) e o mesmo + '|taxa' (saída da taxa).
ALTER TABLE tesouraria_movimentos
    MODIFY origem ENUM('manual', 'despesa_caixa', 'erp_apagar', 'erp_receber') NOT NULL DEFAULT 'manual';

-- Grupo das taxas de recebimento (lançadas como saída separada da entrada bruta).
INSERT IGNORE INTO tesouraria_grupos (nome, exige_veiculo) VALUES ('Taxas Financeiras', 0);

INSERT IGNORE INTO tesouraria_tipos (id_grupo, nome)
SELECT g.id, t.nome
FROM tesouraria_grupos g
JOIN (
    SELECT 'Cartão de Crédito' AS nome UNION ALL
    SELECT 'Cartão de Débito' UNION ALL
    SELECT 'Pix' UNION ALL
    SELECT 'Boleto' UNION ALL
    SELECT 'Mercado Pago'
) t
WHERE g.nome = 'Taxas Financeiras';
