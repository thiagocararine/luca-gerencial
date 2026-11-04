-- Tesouraria — ajuste no modelo de Centro de Custo e custos de veiculo
-- Centro de Custo passa a representar só "quem é o dono do custo" (cada loja,
-- a transportadora, administrativo, outro) — nao mais veiculo/manutencao.
-- Custos de veiculo (manutencao/abastecimento) viram atributos do proprio
-- MOVIMENTO, junto com qual veiculo, para poderem ser atribuidos a qualquer
-- centro de custo (ex: manutencao de um veiculo usado pela Loja X).
--
-- Rode manualmente, do mesmo jeito que a migration anterior:
--   node migrations/run.js migrations/2026-09-30b_tesouraria_centro_custo_veiculo.sql

ALTER TABLE tesouraria_centros_custo
    MODIFY COLUMN tipo ENUM('loja', 'transportadora', 'administrativo', 'outro') NOT NULL,
    ADD COLUMN id_filial INT NULL AFTER tipo,
    DROP COLUMN id_veiculo;

ALTER TABLE tesouraria_movimentos
    ADD COLUMN id_veiculo INT NULL AFTER id_centro_custo,
    ADD COLUMN categoria_veiculo ENUM('manutencao', 'abastecimento') NULL AFTER id_veiculo;

-- Seed com as Unidades reais ja cadastradas em `parametro` (COD_PARAMETRO='Unidades'),
-- consultadas em 2026-09-30. Confira se os IDs ainda batem antes de rodar:
-- INSERT INTO tesouraria_centros_custo (nome, tipo, id_filial) VALUES
--   ('Loja Parada Angelica', 'loja', 27),
--   ('Loja Nova Campinas', 'loja', 36),
--   ('Loja Piabeta', 'loja', 37),
--   ('Loja Santa Cruz', 'loja', 38),
--   ('Loja Mendes dos Santos', 'loja', 39),
--   ('Transportadora (1000TON)', 'transportadora', 239);
