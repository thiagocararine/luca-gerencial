-- Tesouraria — Juros/multa em coluna própria
-- `valor` continua sendo o total pago; `valor_juros` é a parte dele que foi juros/multa.
-- Só mexe nas tabelas da tesouraria no banco GERENCIAL; nada no ERP (sei).
--
-- Rode manualmente (este projeto nao roda DDL automatico):
--   mysql -h <host> -u <user> -p gerencial_lucamat < migrations/2026-11-05b_tesouraria_juros.sql

ALTER TABLE tesouraria_movimentos
    ADD COLUMN valor_juros DECIMAL(12, 2) NULL AFTER valor;
