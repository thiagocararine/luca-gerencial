-- Tesouraria — permite reconfirmar uma despesa de caixa depois de estornada
-- A unicidade (origem, origem_ref) passa a valer so para lancamentos ativos: um
-- lancamento estornado deixa de "consumir" a despesa de caixa de origem, entao ela
-- volta para os pendentes e pode ser confirmada de novo (ex.: na conta certa).
--
-- Rode com:
--   node migrations/run.js migrations/2026-09-30d_tesouraria_reconfirmar_apos_estorno.sql

ALTER TABLE tesouraria_movimentos
    ADD COLUMN origem_ref_ativo VARCHAR(50) AS (IF(status = 'ativo', origem_ref, NULL)) PERSISTENT,
    DROP INDEX uniq_tesmov_origem,
    ADD UNIQUE KEY uniq_tesmov_origem_ativo (origem, origem_ref_ativo);
