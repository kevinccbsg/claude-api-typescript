# Tool use in this repo

How the chat loop in `src/index.ts` drives the `get_system_time` tool, traced
end-to-end with the JSON the SDK actually sees.

## The loop, in one sentence

Every `tool_use` block in the assistant's reply must come back as a matching
`tool_result` block (same `tool_use_id`) inside the next `user` message — and
you keep looping until the model stops with anything other than `tool_use`.

## Walkthrough: "what time is it?"

### Iteration 1 — model decides to call the tool

Request `messages` sent to the API:

```json
[
  { "role": "user", "content": "what time is it?" }
]
```

`final = await stream.finalMessage()` returns:

```json
{
  "id": "msg_01ABC...",
  "type": "message",
  "role": "assistant",
  "model": "claude-sonnet-4-6",
  "stop_reason": "tool_use",
  "content": [
    { "type": "text", "text": "Let me check the current time for you." },
    {
      "type": "tool_use",
      "id": "toolu_01XYZ789",
      "name": "get_system_time",
      "input": {}
    }
  ],
  "usage": { "input_tokens": 412, "output_tokens": 58 }
}
```

Key points:

- `stop_reason: "tool_use"` — the loop does not return; it falls through to the
  tool-result block.
- `content` is an array of blocks, mixing `text` and `tool_use`. The text was
  already streamed to stdout via the `"text"` event.
- The `tool_use` block carries the `id` you must echo back, the `name` to
  dispatch on, and the `input` (empty object here because `get_system_time` has
  no parameters).

### Building the tool result

The `for` loop scans `final.content` and only acts on `tool_use` blocks. After
it runs, `toolResults` looks like:

```json
[
  {
    "type": "tool_result",
    "tool_use_id": "toolu_01XYZ789",
    "content": "{\"year\":2026,\"month\":4,\"day\":28,\"hour\":14,\"minute\":32,\"iso\":\"2026-04-28T14:32:11.000Z\"}"
  }
]
```

`content` is a stringified JSON because `executeTool` does
`JSON.stringify(getSystemTime())`. The API also accepts plain text or content
blocks — a string is the simplest.

### State of `messages` before iteration 2

```json
[
  { "role": "user", "content": "what time is it?" },
  {
    "role": "assistant",
    "content": [
      { "type": "text", "text": "Let me check the current time for you." },
      { "type": "tool_use", "id": "toolu_01XYZ789", "name": "get_system_time", "input": {} }
    ]
  },
  {
    "role": "user",
    "content": [
      {
        "type": "tool_result",
        "tool_use_id": "toolu_01XYZ789",
        "content": "{\"year\":2026,\"month\":4,...}"
      }
    ]
  }
]
```

The tool result is wrapped in a **`user`** message — that is the API contract.
The `tool_use_id` is what pairs the result back to the assistant's tool call.

### Iteration 2 — model produces the final answer

With the same `messages` (now including the tool result), the next
`finalMessage()` returns:

```json
{
  "id": "msg_01DEF...",
  "role": "assistant",
  "stop_reason": "end_turn",
  "content": [
    {
      "type": "text",
      "text": "It's 2:32 PM on April 28, 2026. 现在是下午两点半 — xiànzài shì xiàwǔ liǎng diǎn bàn."
    }
  ],
  "usage": { "input_tokens": 498, "output_tokens": 41 }
}
```

`stop_reason: "end_turn"` — the `if (final.stop_reason !== "tool_use") return;`
check fires and the `while (true)` exits.

## Error handling

There are three error surfaces in the loop, and each has a different shape.

### 1. Tool throws or returns an error payload

The API does not care that your tool failed — it only cares that **every
`tool_use` gets a matching `tool_result`**. Skip it and the next request 400s.
The convention is to set `is_error: true` so the model knows to recover instead
of trusting the payload:

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_01XYZ789",
  "content": "Database timeout after 5s",
  "is_error": true
}
```

The model then typically apologizes, retries, or asks for more info — instead
of hallucinating a successful result.

A safer `executeTool` shape:

```ts
const executeTool = (
  name: string,
  input: unknown,
): { content: string; is_error?: boolean } => {
  try {
    if (name === "get_system_time") {
      return { content: JSON.stringify(getSystemTime()) };
    }
    return { content: `Unknown tool: ${name}`, is_error: true };
  } catch (err) {
    return { content: (err as Error).message, is_error: true };
  }
};
```

The current implementation returns `{"error": "..."}` as a regular result with
`is_error` unset for unknown tools — the model reads that as success data.

### 2. Model returns malformed `input`

`block.input` is typed as `unknown` for a reason — the model can produce
arguments that do not match your schema. If you `JSON.parse` or destructure
blindly inside the tool, you throw. Wrap in try/catch and return `is_error:
true` so the model can correct itself on the next turn.

### 3. SDK / network error before `finalMessage()` resolves

`stream.finalMessage()` rejects (rate limit, 5xx, dropped socket). Nothing has
been pushed to `messages` yet for this iteration, so the conversation state is
still consistent — but the `while (true)` crashes out of `chat()` and bubbles
to `main()`. If you want the REPL to survive, wrap the `await` in try/catch
inside `chat()` and decide whether to retry, drop the turn, or pop the last
user message.

## Invariants to keep in mind

- Every `tool_use` block produced in one assistant turn **must** be answered by
  a `tool_result` block with the same `tool_use_id` in the next user turn.
  Partial answers are an error.
- Tool results live inside a `user` role message, not a synthetic `tool` role.
- `stop_reason` is the loop condition. `"tool_use"` means keep going;
  `"end_turn"`, `"max_tokens"`, `"stop_sequence"` all mean stop.
- The `assistant` message you push back into history must be `final.content`
  (the full block array), not just the text — otherwise the next request loses
  the `tool_use` block and the API rejects the `tool_result` that follows it.

## The three categories of tools

Every tool you give Claude falls into one of three categories. The differences
are not cosmetic — they decide whether you write a handler at all, where the
tool runs, and what the response looks like.

| | Custom tool | Anthropic-defined client tool | Server-side tool |
|---|---|---|---|
| Example in this repo | `get_system_time` | `str_replace_based_edit_tool` | `web_search` |
| Who defines the schema | You | Anthropic | Anthropic |
| Who runs the tool | Your harness | Your harness | Anthropic |
| What you declare | `name`, `description`, `input_schema` | `type`, `name` only | `type`, `name` only |
| Do you write a handler | Yes | Yes | **No** |
| Where the result appears in `final.content` | After your `tool_result` round-trip | After your `tool_result` round-trip | Already paired in the same response (`server_tool_use` + `*_tool_result` blocks) |
| Stop reason that drives the loop | `tool_use` → keep going | `tool_use` → keep going | `end_turn` (or `pause_turn` if Anthropic's server-side cap is hit) |

The first two share the same loop mechanics — that whole "tool_use → execute →
tool_result → loop" walkthrough above. The third one is fundamentally different:
it runs entirely on Anthropic's side and the round-trip never enters your code.

## Anthropic-defined client tool: text editor

Declared in `src/lesson-tools.ts` as:

```ts
export const textEditorTool = {
  type: "text_editor_20250728",
  name: "str_replace_based_edit_tool",
} as const;
```

No `description`, no `input_schema` — Anthropic ships them, and the model has
been **trained on this exact contract**. Your only job is to implement a handler
that responds to the four commands the model emits in `block.input.command`:

| `command` | `input` shape | Purpose |
|---|---|---|
| `view` | `{command, path, view_range?}` | Read a file (with line numbers) or list a directory |
| `create` | `{command, path, file_text}` | Create a new file |
| `str_replace` | `{command, path, old_str, new_str}` | Edit by replacing a unique substring |
| `insert` | `{command, path, insert_line, new_str}` | Insert text at a specific line number |

Why bother with this instead of a custom `save_file({path, content})` tool? Two
reasons:

1. **Model performance.** Anthropic trained the model on these exact command
   names and field shapes. It picks the right command and formats the input
   correctly far more reliably than it does with a custom schema.
2. **Multi-step editing.** A custom `save_file` tool overwrites the whole file
   every time. The text editor tool lets the model `view` first, then make
   surgical edits via `str_replace` or `insert` — much better for long files.

### Tools are contracts, not operations

The most important thing to internalize: the tool declaration only says
*"there is a filesystem-shaped thing with these four commands."* What's actually
behind it is your harness's business. The same tool surface could be backed by:

| Backend | `path` becomes | `create` does |
|---|---|---|
| Local filesystem (current) | a file path | `fs.writeFileSync` |
| SQLite | row key in `lessons(path, content)` | `INSERT INTO lessons VALUES (?, ?)` |
| S3 / object storage | object key | `PutObject` |
| In-memory `Map` | map key | `map.set(path, content)` |
| Git repo | path inside a working tree | write + `git commit` |
| Notion / Google Docs | page ID or title | API call to create a page |

You'd swap the body of `handleTextEditor` and Claude's behavior wouldn't change
— it doesn't know or care what's on the other end. This is true of every tool,
not just the text editor: tools are RPC contracts, the harness owns the
implementation. Same applies to `bash` (you can route shell commands through a
sandbox or remote container), to custom tools, to anything.

**Caveat:** the text editor tool is *trained on filesystem semantics*. The
model expects paths, lines, directories. For record-shaped data (rows, fields,
structured objects), force-fitting it through this tool is awkward — define a
custom tool with a domain-appropriate schema instead.

### Sandboxing

`handleTextEditor` resolves every `path` through `resolveLessonPath`, which
strips a leading `lessons/` prefix if present and `path.resolve`s against
`LESSONS_DIR`. Any resolved path that escapes `LESSONS_DIR` throws. The throw
is caught at the top of the handler and round-trips back to the model as
`is_error: true`, so prompt-injection attempts to write to `/etc/passwd` just
look like a normal tool failure to the model.

## Server-side tool: web search

Declared inline in `src/index.ts`:

```ts
const webSearchTool = {
  type: "web_search_20260209",
  name: "web_search",
} as const;
```

**No handler.** No dispatch case in `executeTool`. When the model decides to
search, Anthropic runs the query on its own infrastructure, feeds the results
back into Claude's context server-side, and Claude continues generating its
answer. By the time `finalMessage()` resolves, the round-trip is already done.

### What `final.content` looks like for a search

```json
[
  { "type": "text", "text": "Let me look that up." },
  {
    "type": "server_tool_use",
    "id": "srvtoolu_01ABC...",
    "name": "web_search",
    "input": { "query": "HSK exam schedule 2026" }
  },
  {
    "type": "web_search_tool_result",
    "tool_use_id": "srvtoolu_01ABC...",
    "content": [
      { "type": "web_search_result", "title": "...", "url": "...", "encrypted_content": "..." }
    ]
  },
  { "type": "text", "text": "The 2026 HSK exam dates are..." }
]
```

The `server_tool_use` and `web_search_tool_result` blocks are **already
paired** — Anthropic emitted both. Your loop's `if (stop_reason !== "tool_use")`
check returns immediately because `stop_reason` is `"end_turn"`; the model has
already finished its answer.

### The `pause_turn` case

Anthropic caps server-side tool iterations at 10 per response. If Claude needs
more (a research task that chains many searches), the response stops with
`stop_reason: "pause_turn"` instead of `end_turn`. To resume, **just re-send
the same conversation** — Anthropic detects the trailing `server_tool_use`
block and continues its server-side loop. Do **not** add a synthetic
`"continue"` user message; that confuses the resume logic.

The handling is one line:

```ts
if (final.stop_reason === "pause_turn") continue;  // resume server-side loop
if (final.stop_reason !== "tool_use") return;
```

### Why server-side tools are otherwise invisible

`stream.on("text", ...)` only fires for text deltas. The `server_tool_use` and
`*_tool_result` blocks stream through other event types but produce no
user-visible text. To the user it looks like Claude paused for a moment, then
kept talking. To make the activity visible, the loop now scans `final.content`
after each turn and prints `[searched: ...]` to stderr for each search the
model issued. This is purely for learning; drop it once the behavior is
familiar.

## Quick decision guide: which tool category to reach for

- **Server-side tool** if Anthropic ships one for the job (web search, web
  fetch, code execution). Lowest implementation cost, no compute on your side.
- **Anthropic-defined client tool** if your data is file-shaped and you want
  the model's best file-editing behavior — even if "files" are a fiction
  backed by a database.
- **Custom tool** for everything else: domain-specific operations, structured
  records, side-effecting actions like sending emails or hitting an internal
  API. Define the schema to match your domain, not someone else's.
