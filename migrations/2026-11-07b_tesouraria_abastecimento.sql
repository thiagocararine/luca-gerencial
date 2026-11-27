-- Tesouraria: litros e KM no pagamento de combustível (vai para o relatório de abastecimento).
-- Só mexe no banco GERENCIAL; nada no ERP (sei).
--
-- Rode manualmente (este projeto nao roda DDL automatico):
--   mysql -h <host> -u <user> -p gerencial_lucamat < migrations/2026-11-07b_tesouraria_abastecimento.sql

ALTER TABLE tesouraria_movimentos
    ADD COLUMN litros DECIMAL(10, 2) NULL AFTER id_veiculo,
    ADD COLUMN odometro INT NULL AFTER litros;
