import fs from "node:fs/promises";
import path from "node:path";

const LESSONS_DIR = path.resolve("lessons");

export interface Chunk {
  source: string;
  index: number;
  text: string;
}

const walkMarkdown = async (dir: string, base = dir): Promise<string[]> => {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkMarkdown(full, base)));
    else if (entry.name.endsWith(".md")) out.push(path.relative(base, full));
  }
  return out;
};

export const loadAndChunk = async (size = 500, overlap = 100): Promise<Chunk[]> => {
  const chunks: Chunk[] = [];
  for (const rel of await walkMarkdown(LESSONS_DIR)) {
    const text = await fs.readFile(path.join(LESSONS_DIR, rel), "utf-8");
    let start = 0;
    let idx = 0;
    while (start < text.length) {
      const end = Math.min(start + size, text.length);
      const slice = text.slice(start, end).trim();
      if (slice) chunks.push({ source: rel, index: idx++, text: slice });
      if (end === text.length) break;
      start += size - overlap;
    }
  }
  return chunks;
};

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const chunks = await loadAndChunk();
  console.log(`${chunks.length} chunks`);
  console.log(chunks[0]);
}
