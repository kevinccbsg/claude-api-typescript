import "dotenv/config";
import pg from "pg";
import { loadAndChunk } from "./chunkLessons";
import { embedChunks } from "./embeddings";

const { Pool } = pg;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5432/rag",
});

const initSchema = async () => {
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chunks (
      id SERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      chunk_index INT NOT NULL,
      text TEXT NOT NULL,
      embedding vector(1024) NOT NULL,
      UNIQUE (source, chunk_index)
    )
  `);
};

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  await initSchema();

  const chunks = await loadAndChunk();
  const embedded = await embedChunks(chunks);

  for (const c of embedded) {
    await pool.query(
      `INSERT INTO chunks (source, chunk_index, text, embedding)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (source, chunk_index)
       DO UPDATE SET text = EXCLUDED.text, embedding = EXCLUDED.embedding`,
      [c.source, c.index, c.text, JSON.stringify(c.embedding)],
    );
  }

  console.log(`Stored ${embedded.length} chunks in postgres`);
  await pool.end();
}
