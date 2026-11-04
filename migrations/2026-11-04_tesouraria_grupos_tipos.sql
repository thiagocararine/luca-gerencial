-- Tesouraria — classificacao propria (Grupo / Tipo de despesa)
-- A tesouraria deixa de usar a lista "Grupo Despesa / Tipo Despesa" de Configuracoes >
-- Parametros (que e a das lojas, em Lancamentos) e passa a ter a sua, editavel na
-- propria tela da tesouraria. Os movimentos continuam guardando o NOME do grupo e do
-- tipo (grupo_despesa / tipo_despesa), entao nada muda em tesouraria_movimentos.
--
-- Rode com:
--   node migrations/run.js migrations/2026-11-04_tesouraria_grupos_tipos.sql

CREATE TABLE IF NOT EXISTS tesouraria_grupos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    exige_veiculo TINYINT(1) NOT NULL DEFAULT 0,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_tesgrupo_nome (nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tesouraria_tipos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_grupo INT NOT NULL,
    nome VARCHAR(100) NOT NULL,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_testipo_grupo FOREIGN KEY (id_grupo) REFERENCES tesouraria_grupos(id),
    UNIQUE KEY uniq_testipo_grupo_nome (id_grupo, nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Lista inicial passada pelo Thiago em 2026-09-30. O resto ele cadastra pela tela.
INSERT IGNORE INTO tesouraria_grupos (nome, exige_veiculo) VALUES
    ('Manutenção', 1),
    ('Combustível', 1),
    ('Pessoal', 0),
    ('Compras', 0),
    ('Despesa Loja', 0);

INSERT IGNORE INTO tesouraria_tipos (id_grupo, nome)
    SELECT id, 'Óleo S10' FROM tesouraria_grupos WHERE nome = 'Combustível';
INSERT IGNORE INTO tesouraria_tipos (id_grupo, nome)
    SELECT id, 'Arla' FROM tesouraria_grupos WHERE nome = 'Combustível';
INSERT IGNORE INTO tesouraria_tipos (id_grupo, nome)
    SELECT id, 'Comissão' FROM tesouraria_grupos WHERE nome = 'Pessoal';
INSERT IGNORE INTO tesouraria_tipos (id_grupo, nome)
    SELECT id, 'Diária' FROM tesouraria_grupos WHERE nome = 'Pessoal';
INSERT IGNORE INTO tesouraria_tipos (id_grupo, nome)
    SELECT id, 'Adiantamento' FROM tesouraria_grupos WHERE nome = 'Pessoal';
