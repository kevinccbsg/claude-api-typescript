# claude-api-typescript

A learning repository that walks through Anthropic's Claude API course concepts
**in TypeScript**, building progressively from a single API call to a working
mini-RAG pipeline. The goal is depth over breadth — each topic is a small,
self-contained example you can run, read, and break.

## What this repo covers

### 1. Claude API foundations (`src/index.ts`)

A REPL chat agent against `claude-sonnet-4-6` covering the basics that
everything else builds on:

- Calling `messages.stream()` and consuming text deltas as they arrive
- Multi-turn conversation state — pushing `final.content` (not just text) back
  into the message history so tool-use blocks survive the round-trip
- A `system` prompt that frames the assistant as a beginner Chinese teacher
- Structured output scaffolding via Zod schemas (commented out in the loop —
  toggle on to see schema-validated responses)

### 2. Tool use — three categories

Detailed walkthrough in [`docs/tools.md`](docs/tools.md). The chat loop wires up
all three categories so the differences are concrete:

| Category | Example in this repo | Who runs it | Handler needed? |
|---|---|---|---|
| **Custom tool** | `get_system_time` (`src/tools.ts`) | Your harness | Yes |
| **Anthropic-defined client tool** | `str_replace_based_edit_tool` (`src/lesson-tools.ts`) | Your harness | Yes — the model is *trained* on the contract |
| **Server-side tool** | `web_search` (declared inline) | **Anthropic** | **No** — round-trip happens server-side |

The text editor tool is sandboxed to the `lessons/` folder, so the model can
ask you to save Chinese lessons as markdown files (`hsk1/numbers.md`, etc.) and
you get a real audit trail of what was created. Web search runs entirely on
Anthropic's infrastructure — when you ask "what's new in HSK 2026?" the search
queries fire server-side and the model returns with grounded answers.

The doc also covers `is_error: true` round-trips, the `pause_turn` stop reason
for server-side iteration limits, and why "tools are RPC contracts, the harness
owns the implementation."

### 3. Retrieval-augmented generation (`src/rag/`)

A minimal four-stage RAG pipeline against the `lessons/` folder. Detailed
walkthrough in [`docs/rag.md`](docs/rag.md).

```
lessons/*.md → chunkLessons.ts → embeddings.ts → store.ts → search.ts
   (markdown)     (sliding         (Voyage         (Postgres   (cosine
                   window)          voyage-3,       + pgvector) top-k)
                                   1024 dims)
```

The interesting parts aren't the happy-path code — they're the failure modes
the doc captures: why source format matters more than chunking strategy, why
embedding similarity ranks the wrong chunk first sometimes, and why
production RAG spends most of its time on the boring infrastructure.

## Setup

```sh
npm install

cp .env.example .env
# Fill in:
#   ANTHROPIC_API_KEY=sk-ant-...
#   VOYAGE_API_KEY=pa-...

# Optional, for the RAG pipeline:
npm run db:up         # starts Postgres + pgvector via docker-compose
```

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Interactive Claude chat REPL with all three tool categories wired up |
| `npm run chunk` | Splits `lessons/*.md` into overlapping text chunks |
| `npm run embed` | Embeds all chunks via Voyage (`voyage-3`, 1024 dims) |
| `npm run store` | Persists embedded chunks into Postgres (`pgvector`); idempotent |
| `npm run search` | Top-k cosine-similarity retrieval against the stored chunks |
| `npm run db:up` | Starts the local Postgres+pgvector container |
| `npm run db:down` | Stops it (data persists in the named volume) |

## Project layout

```
.
├── src/
│   ├── index.ts            # REPL chat loop with tool dispatch
│   ├── tools.ts            # Custom tool: get_system_time
│   ├── lesson-tools.ts     # Anthropic-defined text editor tool
│   ├── schemas.ts          # Zod schemas for structured outputs
│   └── rag/
│       ├── chunkLessons.ts # Sliding-window markdown chunker
│       ├── embeddings.ts   # Voyage AI client + embedChunks / embedQuery
│       ├── store.ts        # Schema init + chunk upsert (Postgres)
│       └── search.ts       # Cosine top-k retrieval
├── docs/
│   ├── tools.md            # Deep dive on tool use
│   └── rag.md              # Deep dive on RAG, with failure-mode lessons
├── lessons/                # Markdown lesson files (created by the agent)
├── docker-compose.yml      # Postgres 16 + pgvector
├── tsconfig.json
└── package.json
```

## Recommended reading order

1. Run `npm start`, type *"what time is it?"* — see a custom tool round-trip.
2. Type *"save a lesson on numbers 1–10 in Chinese"* — watch the text editor
   tool create files in `lessons/`.
3. Type *"what's new with HSK in 2026?"* — observe `[searched: ...]` appear as
   web search runs server-side.
4. Read [`docs/tools.md`](docs/tools.md) for the JSON contracts behind all three.
5. Run `npm run chunk` → `embed` → `db:up` → `store` → `search` and follow the
   pipeline end-to-end.
6. Read [`docs/rag.md`](docs/rag.md) for the lessons that don't show up in the
   happy path — the PDF extraction disaster, the embedding-vs-relevance trap,
   the asymmetry of document vs query embeddings.

## Course inspiration

This repo follows along with Anthropic's official Claude API course but
re-implements every concept in TypeScript using the official
`@anthropic-ai/sdk`. Models, prompt-caching strategy, tool versions, and
streaming patterns track current Claude API guidance. Voyage AI provides the
embedding stack (`voyage-3`); Postgres + `pgvector` handles vector storage
locally via Docker.

Not a production reference — a working, opinionated playground for
understanding what each layer does and what the trade-offs look like.
