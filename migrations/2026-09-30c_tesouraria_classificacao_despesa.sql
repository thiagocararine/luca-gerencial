-- Tesouraria — classificacao de despesa (reaproveita Grupo Despesa / Tipo Despesa)
-- Alinha o lancamento da tesouraria com os campos reais usados no dia a dia:
-- data da despesa (vencimento) separada da data de pagamento, numero da NF,
-- e a mesma classificacao Grupo/Tipo Despesa que despesa_caixa ja usa.
--
-- Rode com:
--   node migrations/run.js migrations/2026-09-30c_tesouraria_classificacao_despesa.sql

ALTER TABLE tesouraria_movimentos
    DROP COLUMN categoria_veiculo,
    ADD COLUMN data_despesa DATE NULL AFTER data_movimento,
    ADD COLUMN numero_nf VARCHAR(50) NULL AFTER descricao,
    ADD COLUMN grupo_despesa VARCHAR(255) NULL AFTER numero_nf,
    ADD COLUMN tipo_despesa VARCHAR(255) NULL AFTER grupo_despesa;

-- Novos Tipos de Despesa pedidos pelo Thiago (Diaria e Adiantamento de motorista/funcionario),
-- vinculados ao grupo "Pessoal" (KEY_VINCULACAO = 1), mesmo padrao usado por "Comissão".
-- `parametro.ID` NAO e auto_increment (mesmo padrao ja usado em routes_settings.js:51-52),
-- por isso calculamos o proximo ID manualmente aqui.
SET @next_id = (SELECT MAX(ID) FROM parametro);
INSERT INTO parametro (ID, COD_PARAMETRO, NOME_PARAMETRO, KEY_VINCULACAO) VALUES (@next_id + 1, 'Tipo Despesa', 'Diária', 1);

SET @next_id = (SELECT MAX(ID) FROM parametro);
INSERT INTO parametro (ID, COD_PARAMETRO, NOME_PARAMETRO, KEY_VINCULACAO) VALUES (@next_id + 1, 'Tipo Despesa', 'Adiantamento', 1);
