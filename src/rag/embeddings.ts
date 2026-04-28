import "dotenv/config";
import { createRequire } from "node:module";
import { loadAndChunk, type Chunk } from "./chunkLessons";

// voyageai 0.2.1 ships a broken ESM build (extensionless internal imports);
// load via CJS to dodge the resolution bug.
const require = createRequire(import.meta.url);
const { VoyageAIClient } = require("voyageai") as typeof import("voyageai");

export interface EmbeddedChunk extends Chunk {
  embedding: number[];
}

const client = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });

export const embedChunks = async (
  chunks: Chunk[],
  inputType: "document" | "query" = "document",
): Promise<EmbeddedChunk[]> => {
  const response = await client.embed({
    input: chunks.map((c) => c.text),
    model: "voyage-3",
    inputType,
  });
  const data = response.data ?? [];
  return chunks.map((c, i) => ({ ...c, embedding: data[i]!.embedding! }));
};

export const embedQuery = async (text: string): Promise<number[]> => {
  const response = await client.embed({
    input: text,
    model: "voyage-3",
    inputType: "query",
  });
  return response.data?.[0]?.embedding ?? [];
};

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const chunks = await loadAndChunk();
  const embedded = await embedChunks(chunks);
  console.log(`Embedded ${embedded.length} chunks`);
  console.log(`Vector dimension: ${embedded[0].embedding.length}`);
  console.log(
    `First 5 values of chunk 0: [${embedded[0].embedding
      .slice(0, 5)
      .map((v) => v.toFixed(4))
      .join(", ")}, ...]`,
  );
}
