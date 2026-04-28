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
