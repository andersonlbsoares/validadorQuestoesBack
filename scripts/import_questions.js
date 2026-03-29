require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

async function run() {
  const fileArg = process.argv[2];

  if (!fileArg) {
    console.error('Uso: node scripts/import_questions.js <caminho-do-json>');
    process.exit(1);
  }

  const fullPath = path.resolve(process.cwd(), fileArg);
  console.log(`Lendo arquivo: ${fullPath}`);

  if (!fs.existsSync(fullPath)) {
    console.error('Arquivo JSON não encontrado');
    process.exit(1);
  }

  let raw;
  try {
    raw = fs.readFileSync(fullPath, 'utf-8');
  } catch (err) {
    console.error('Erro ao ler arquivo JSON:', err.message);
    process.exit(1);
  }

  let questions;
  try {
    questions = JSON.parse(raw);
  } catch (err) {
    console.error('JSON inválido:', err.message);
    process.exit(1);
  }

  if (!Array.isArray(questions)) {
    console.error('O JSON deve conter uma lista (array) de questões');
    process.exit(1);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const item of questions) {
      if (!item.id) {
        throw new Error('Questão sem id encontrada no JSON');
      }

      const statusRevisao = item.status_revisao || 'pendente';

      await client.query(
        `INSERT INTO questions (
          id,
          ano,
          prova,
          caderno,
          numero_questao,
          pagina_inicial,
          pagina_final,
          texto_apoio,
          enunciado,
          alternativas,
          resposta,
          recursos_visuais,
          textos_apoio_adicionais,
          status_extracao,
          status_revisao,
          observacoes,
          arquivo_origem,
          pdf_path,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10::jsonb, $11, $12::jsonb, $13::jsonb,
          $14, $15, $16, $17, $18, NOW()
        )
        ON CONFLICT (id)
        DO UPDATE SET
          ano = EXCLUDED.ano,
          prova = EXCLUDED.prova,
          caderno = EXCLUDED.caderno,
          numero_questao = EXCLUDED.numero_questao,
          pagina_inicial = EXCLUDED.pagina_inicial,
          pagina_final = EXCLUDED.pagina_final,
          texto_apoio = EXCLUDED.texto_apoio,
          enunciado = EXCLUDED.enunciado,
          alternativas = EXCLUDED.alternativas,
          resposta = EXCLUDED.resposta,
          recursos_visuais = EXCLUDED.recursos_visuais,
          textos_apoio_adicionais = EXCLUDED.textos_apoio_adicionais,
          status_extracao = EXCLUDED.status_extracao,
          status_revisao = EXCLUDED.status_revisao,
          observacoes = EXCLUDED.observacoes,
          arquivo_origem = EXCLUDED.arquivo_origem,
          pdf_path = EXCLUDED.pdf_path,
          updated_at = NOW()`,
        [
          item.id,
          item.ano ?? null,
          item.prova ?? null,
          item.caderno ?? null,
          item.numero_questao ?? null,
          item.pagina_inicial ?? null,
          item.pagina_final ?? null,
          item.texto_apoio ?? '',
          item.enunciado ?? '',
          JSON.stringify(item.alternativas ?? {}),
          item.resposta ?? null,
          JSON.stringify(item.recursos_visuais ?? []),
          JSON.stringify(item.textos_apoio_adicionais ?? []),
          item.status_extracao ?? null,
          statusRevisao,
          item.observacoes ?? '',
          item.arquivo_origem ?? null,
          item.pdf_path ?? null,
        ]
      );
    }

    await client.query('COMMIT');
    console.log(`Importação concluída com sucesso. Registros processados: ${questions.length}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro na importação:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(async (err) => {
  console.error('Erro inesperado:', err.message);
  await pool.end();
  process.exit(1);
});
