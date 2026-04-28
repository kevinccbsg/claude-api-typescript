# RAG in this repo

Notes from building a minimal RAG pipeline against the `lessons/` folder.
The goal is **understanding what each layer costs and where the surprises hide**,
not shipping production retrieval. Real lessons from real bugs we hit while
building it.

## The pipeline

Four scripts, one Postgres container:

```
lessons/*.md
    │
    ▼  npm run chunk
loadAndChunk()           sliding window over markdown text
    │
    ▼  npm run embed
embedChunks()            Voyage AI voyage-3 → 1024-dim vector per chunk
    │
    ▼  npm run store
store.ts                 INSERT INTO chunks(... vector(1024)) — pgvector
    │
    ▼  npm run search
search.ts                ORDER BY embedding <=> query_embedding LIMIT k
```

Each stage is in its own file under `src/rag/`. They compose top-down — `store`
calls `loadAndChunk` then `embedChunks`; `search` calls `embedQuery` and runs SQL
against whatever `store` already inserted.

## Lesson 1 — Source format dominates everything else

We started by trying to RAG over two HSK 1 storybook PDFs. The chunker worked
fine; the *content* was garbage:

```
[1] |
LovE
MY PARENTS
RRZRHSSBS         ← should have been 我爱我的父母
KRNSSERE,         ← should have been 我和爸爸妈妈
BUWE2.            ← every Chinese character lost
```

The PDFs embedded their Chinese characters as font glyphs without proper Unicode
`ToUnicode` cmaps, so `pdfjs-dist` (under `unpdf`) couldn't recover them. English
titles and pinyin came through fine; the entire main body was unrecoverable
without OCR or vision-model transcription.

After switching to native markdown lessons, the same chunker produced:

```
我给你一本书。Wǒ gěi nǐ yī běn shū. I give you a book.
```

Every character intact, every diacritic preserved. **No chunking change.** Just
clean source.

The hierarchy:

| Source | Extraction quality | RAG-ready? |
|---|---|---|
| Native markdown / plain text | Perfect — UTF-8 in, UTF-8 out | ✅ |
| Well-formed PDF with Unicode cmap | Latin solid, CJK hit-or-miss | ⚠️ |
| PDF with custom font encoding | Latin OK, CJK lost | ❌ without OCR or vision |
| Scanned image PDFs | Bytes are pixels | ❌ requires OCR |

The takeaway: in production RAG, **far more engineering goes into extraction
than into chunking**. The chunker is ~50 lines and rarely the bottleneck. The
extractor handles tables, footnotes, multi-column layouts, scanned pages,
formula rendering, language detection. When retrieval is bad, the fix is almost
always upstream of chunking.

## Lesson 2 — Sliding-window chunking is fine until it isn't

Our chunker is the simplest possible: 500-character window, 100-character
overlap, sliding across the concatenated file text.

```ts
while (start < text.length) {
  const end = Math.min(start + size, text.length);
  chunks.push({ source, index, text: text.slice(start, end).trim() });
  start += size - overlap;
}
```

This works for tiny lesson files. It breaks down because it splits *blindly* —
mid-sentence, mid-table, mid-section. The verb-usage section of a `给` lesson
might end up half in chunk N and half in chunk N+1. Retrieval then has to find
"the section about verb usage" by matching against fragments that don't
individually represent the section well.

A better pattern for structured content (called **recursive structural
chunking**) leverages the document's own boundaries:

1. Split on `##` headers → one chunk per topical section
2. If a section is still too big, recursively split on `###`
3. If still too big, fall back to sliding window
4. Prefix each chunk with its parent header(s) so it's self-contained

Same code complexity. Dramatically better topical cohesion — and as we'll see in
lesson 5, that matters because retrieval ranks on whole-chunk semantics.

We didn't ship this in this repo — naive chunking was enough to hit the more
interesting failure modes downstream. But it's the obvious next upgrade for
markdown-shaped content.

## Lesson 3 — Embeddings are asymmetric

Voyage's `embed` API takes an `inputType` parameter:

```ts
await client.embed({
  input: chunks.map(c => c.text),
  model: "voyage-3",
  inputType: "document",   // ← for ingestion
});

await client.embed({
  input: userQuery,
  model: "voyage-3",
  inputType: "query",      // ← for retrieval
});
```

It's not cosmetic. Voyage trains the model so document and query embeddings of
the same content land *closer together* when these labels are correct. Mislabel
and you get worse retrieval — same vectors, worse geometry between them.

This is why `embeddings.ts` exports two functions: `embedChunks` defaults to
`document`, `embedQuery` hardcodes `query`. Two callsites, two intents.

Voyage `voyage-3` returns **1024-dimensional float32 vectors** by default. For
production scale you'd care about:

- `outputDimension` — request shorter vectors (256/512). Smaller = faster search,
  less storage, slight quality loss.
- `outputDtype` — `int8` / `binary` for compression. Storage wins are massive at
  scale (32× for binary), retrieval is approximate.
- `voyage-3-large` for higher quality, `voyage-3-lite` for cheaper/faster.

For the lessons folder all defaults are fine.

## Lesson 4 — Vector storage is just Postgres

`pgvector` is a Postgres extension that adds one column type and a few
operators. The `docker-compose.yml` runs the official `pgvector/pgvector:pg16`
image, the schema is one table:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE chunks (
  id           SERIAL PRIMARY KEY,
  source       TEXT NOT NULL,
  chunk_index  INT  NOT NULL,
  text         TEXT NOT NULL,
  embedding    vector(1024) NOT NULL,
  UNIQUE (source, chunk_index)
);
```

Two non-obvious things:

1. **The dimension is part of the type.** `vector(1024)` is what `voyage-3`
   produces. Switching embedding models with different dimensions means altering
   the column or rebuilding the table. This is intentional — pgvector validates
   inserts against the declared dimension.
2. **Vectors go in as text.** `JSON.stringify([0.1, 0.2, ...])` produces
   `[0.1,0.2,...]`, which is exactly the format pgvector parses for vector
   literals. No special driver, no adapter — plain `node-postgres` works.

For 3 chunks no index is needed. At 10K+ chunks you'd add:

```sql
CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);
```

HNSW is approximate-nearest-neighbor — much faster, slightly lower recall.

## Lesson 5 — Cosine distance, not similarity

pgvector's distance operators:

| Operator | Meaning | Range | Best |
|---|---|---|---|
| `<->` | Euclidean distance | `[0, ∞)` | smaller |
| `<=>` | Cosine distance | `[0, 2]` | smaller |
| `<#>` | Negative inner product | `(-∞, 0]` | smaller |

We use `<=>` because Voyage embeddings are normalized — cosine distance is the
right semantic match. **Smaller is closer**, so retrieval is `ORDER BY embedding
<=> $1 LIMIT k`.

For human-readable output we convert to similarity via `1 - (embedding <=> $1)`,
which lands in `[-1, 1]`. Higher is better. Less surprising in logs.

## Lesson 6 — Embedding similarity ≠ answer relevance

The most important RAG lesson hiding in our tiny dataset.

The lesson file `lessons/hsk1/gei_character.md` has three sections, which become
three chunks:
- Chunk #0 — "What is 给? / As a Verb → 'to give'"
- Chunk #1 — "As a Preposition → 'to / for' (Subject + 给 + Person + Verb)"
- Chunk #2 — "HSK Vocabulary with 给"

Querying `"How do I use 给 as a verb?"` produced this ranking:

| Rank | Similarity | Chunk |
|---|---|---|
| 1 | 0.671 | #1 — the **preposition** section |
| 2 | 0.669 | #2 — the vocab table |
| 3 | 0.656 | #0 — the **verb** section (the actual answer) |

Notice anything? The chunk explicitly *about* 给-as-a-verb ranked **third**.

Why: chunk #1 contains the literal word **"Verb"** in its grammar pattern
(`Subject + 给 + Person + Verb`), while chunk #0 talks about "to give" without
ever using the word "verb". Embeddings measure overall semantic proximity, not
topical correctness — and dense surface-form overlap on a salient query token
("verb") wins out.

This is the central tension in vector retrieval: **embeddings are a strong
proxy for relevance, not a proof of it**. It's not a bug, it's the technique.
Production mitigations:

1. **Retrieve more, filter later.** Top-20 instead of top-5, then let an LLM
   pick the actually-relevant ones at answer time. Cheap and effective.
2. **Hybrid search.** Combine vector retrieval with BM25 (keyword/lexical).
   BM25 would have rewarded chunk #0 for "to give" if the query had been
   phrased "what does 给 mean as a verb." Hybrid usually beats either alone.
3. **Reranking.** Run top-N through a dedicated reranker (Voyage has
   `voyage-rerank-2`) that scores query-vs-chunk pairs more carefully. Slower,
   much higher precision.
4. **Better chunking.** A header-aware chunker would have made chunk #0 a
   single, self-contained "as a verb" section — its dense semantics would
   match the query's intent more cleanly. Lesson 2 again.

A useful heuristic: if you can't articulate why retrieval ranked X above Y,
the failure isn't your prompt — it's that your chunks aren't topically
coherent enough for the embedding to discriminate cleanly.

## Lesson 7 — Production RAG is mostly boring infrastructure

After building this, the unglamorous truth crystallizes. The vector math in the
middle is the easy part. Where production teams actually spend months:

- **Extraction** — turning messy sources into clean UTF-8. Tables, footnotes,
  multi-column, formulas, scanned pages, multi-language detection.
- **Chunking** — structural awareness, prefix propagation, dynamic sizing.
- **Hybrid retrieval** — vector + BM25 fusion (RRF, weighted), tuning ratios.
- **Reranking** — model choice, when to apply, latency budgets.
- **Query rewriting** — turning user questions into multiple search queries,
  query expansion, hypothetical-document embedding (HyDE).
- **Evaluation** — measuring whether changes actually help. Usually a
  golden-set + recall@k + human spot-checks. Without this, every change feels
  like progress.

The lesson: a good RAG system isn't one perfect technique — it's a stack where
every layer compounds. And almost every team rebuilds half of it once or
twice as they learn what their data and queries actually look like.

## The four scripts

| Script | What it does | When to run |
|---|---|---|
| `npm run chunk` | Reads `lessons/`, prints chunks. Pure read-only inspection. | After editing lessons, to sanity-check splits |
| `npm run embed` | Loads, chunks, embeds. Logs vector dim + sample. No DB writes. | Verify Voyage credentials work; smoke-test embeddings |
| `npm run store` | Loads, chunks, embeds, **upserts** to Postgres. | After lesson changes — `ON CONFLICT DO UPDATE` keeps it idempotent |
| `npm run search` | Embeds a hardcoded query, runs cosine top-k against the table. | Test retrieval; tweak the `query` variable inline |

Two helper scripts manage the local Postgres container:
- `npm run db:up` — starts pgvector in the background
- `npm run db:down` — stops it (data persists in the named volume)

## Footnote — the createRequire workaround

`src/rag/embeddings.ts` loads voyageai through `createRequire` instead of a
plain ESM import:

```ts
const require = createRequire(import.meta.url);
const { VoyageAIClient } = require("voyageai") as typeof import("voyageai");
```

The voyageai 0.2.1 ESM build ships extensionless internal imports
(`export * from "../api"`) that Node's strict ESM resolver rejects. The CJS
build works fine. `createRequire` gives us a synchronous CJS resolver from
inside an ESM module — same package, working build, types preserved via the
`as typeof import(...)` cast.

If voyageai ships a fix in a future version, the change is one line: revert to
the plain `import { VoyageAIClient } from "voyageai"`. Until then, this is the
clean workaround. tsconfig settings can't fix it — TypeScript compiles your
code, not third-party `.mjs` files at runtime.
