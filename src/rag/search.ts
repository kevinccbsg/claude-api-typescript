import "dotenv/config";
import pg from "pg";
import { embedQuery } from "./embeddings";

const { Pool } = pg;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5432/rag",
});

// Edit this to test different queries
const query = "How do I use 给 as a verb?";
const topK = 5;

const queryEmbedding = await embedQuery(query);

const result = await pool.query(
  `SELECT source, chunk_index, text, 1 - (embedding <=> $1) AS similarity
   FROM chunks
   ORDER BY embedding <=> $1
   LIMIT $2`,
  [JSON.stringify(queryEmbedding), topK],
);

console.log(`Query: "${query}"\n`);
if (result.rows.length === 0) {
  console.log("No chunks in the database. Run `npm run store` first.");
} else {
  for (const row of result.rows) {
    const preview = row.text.length > 200 ? row.text.slice(0, 200) + "..." : row.text;
    console.log('--------------------------------');
    console.log(`[similarity ${row.similarity.toFixed(3)}] ${row.source} #${row.chunk_index}`);
    console.log(preview);
    console.log();
  }
}

await pool.end();
