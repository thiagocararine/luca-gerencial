-- Apurado: baixas de títulos de dias anteriores que a operadora deixou fora do dia.
-- O ERP grava a baixa no dia em que foi digitada, não no dia em que o dinheiro entrou
-- (ex.: Pix de 19/11 baixado em 23/11). No "Puxar apurado" essas baixas aparecem uma a uma,
-- marcadas; a que ela desmarca fica registrada aqui e sai do valor do dia.
-- Só leitura no ERP: rc_regist é o registro do contas a receber (receber.rc_regist).

CREATE TABLE IF NOT EXISTS tesouraria_apurado_titulos_fora (
    data_movimento DATE NOT NULL,
    rc_regist INT NOT NULL,
    cod_filial VARCHAR(10) NOT NULL,
    modalidade VARCHAR(30) NOT NULL,
    valor DECIMAL(12,2) NOT NULL,
    id_usuario INT NULL,
    nome_usuario VARCHAR(255) NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (data_movimento, rc_regist),
    KEY idx_titulos_fora_linha (data_movimento, cod_filial, modalidade)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
