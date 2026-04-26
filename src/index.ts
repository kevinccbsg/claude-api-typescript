import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const model = "claude-sonnet-4-6";

const message = await client.messages.create({
  model,
  max_tokens: 1000,
  messages: [
    {
      role: "user",
      content: "What is quantum computing? Answer in one sentence",
    },
  ],
});

const firstBlock = message.content[0];
if (firstBlock.type === "text") {
  console.log(firstBlock.text);
}
