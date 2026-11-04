-- Tesouraria — Fase A
-- Cria as tabelas novas do modulo de tesouraria no banco GERENCIAL (gerencial_lucamat).
-- Nao mexe em nenhuma tabela existente nem no banco do ERP (sei).
--
-- Rode manualmente (este projeto nao roda DDL automatico):
--   mysql -h <host> -u <user> -p gerencial_lucamat < migrations/2026-09-30_tesouraria_fase_a.sql

CREATE TABLE IF NOT EXISTS tesouraria_contas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    tipo ENUM('caixa_filial', 'caixa_financeiro', 'banco') NOT NULL,
    id_filial INT NULL,
    banco_nome VARCHAR(100) NULL,
    banco_agencia VARCHAR(20) NULL,
    banco_conta VARCHAR(20) NULL,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    ordem INT NOT NULL DEFAULT 0,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tesouraria_centros_custo (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    tipo ENUM('loja', 'manutencao', 'veiculo', 'administrativo', 'outro') NOT NULL,
    id_veiculo INT NULL,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tesouraria_movimentos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_conta INT NOT NULL,
    id_centro_custo INT NULL,
    data_movimento DATE NOT NULL,
    tipo ENUM('entrada', 'saida') NOT NULL DEFAULT 'saida',
    valor DECIMAL(12, 2) NOT NULL,
    descricao VARCHAR(255) NOT NULL,
    favorecido VARCHAR(255) NULL,
    forma_pagamento VARCHAR(50) NULL,
    origem ENUM('manual', 'despesa_caixa', 'erp_apagar') NOT NULL DEFAULT 'manual',
    origem_ref VARCHAR(50) NULL,
    status ENUM('ativo', 'estornado') NOT NULL DEFAULT 'ativo',
    id_movimento_estornado INT NULL,
    id_usuario_lancamento INT NOT NULL,
    nome_usuario_lancamento VARCHAR(255) NULL,
    data_lancamento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tesmov_conta FOREIGN KEY (id_conta) REFERENCES tesouraria_contas(id),
    CONSTRAINT fk_tesmov_centro FOREIGN KEY (id_centro_custo) REFERENCES tesouraria_centros_custo(id),
    CONSTRAINT fk_tesmov_estorno FOREIGN KEY (id_movimento_estornado) REFERENCES tesouraria_movimentos(id),
    CONSTRAINT uniq_tesmov_origem UNIQUE KEY (origem, origem_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Exemplo de seed manual de contas (ajuste nomes/filiais e rode a parte que fizer sentido; opcional):
-- INSERT INTO tesouraria_contas (nome, tipo) VALUES ('Caixa Financeiro', 'caixa_financeiro');
-- INSERT INTO tesouraria_contas (nome, tipo, banco_nome) VALUES ('Banco Santander (Lucamat)', 'banco', 'Santander');
