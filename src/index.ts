import Anthropic from "@anthropic-ai/sdk";
import readline from "node:readline/promises";
import { ChineseReplySchema, type ChineseReply } from "./schemas";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod.js";
import { getSystemTime, getSystemTimeTool } from "./tools";

const client = new Anthropic();
const model = "claude-sonnet-4-6";

const allMessages: Anthropic.MessageParam[] = [];
const storeResponses: Anthropic.Messages.Message[] = [];

const systemPrompt = `
You are a helpful chinese teacher focus on hsk1 hsk2 level for beginners.
You will always give chinese tips of language based on the conversation if it is not about hsk doubts.
`;

const addUserMessage = (text: string) => {
  allMessages.push({ role: "user", content: text });
};

const executeTool = (name: string, input: unknown): string => {
  if (name === "get_system_time") {
    return JSON.stringify(getSystemTime());
  }
  return JSON.stringify({ error: `Unknown tool: ${name}` });
};

const chat = async (messages: Anthropic.MessageParam[]): Promise<void> => {
  while (true) {
    const stream = client.messages.stream({
      model,
      max_tokens: 1000,
      messages,
      system: systemPrompt,
      tools: [getSystemTimeTool],
      // output_config: {
      //   format: zodOutputFormat(ChineseReplySchema),
      //   effort: 'low',
      // },
    });
    stream.on("text", (delta) => process.stdout.write(delta));
    const final = await stream.finalMessage();
    storeResponses.push(final);
    messages.push({ role: "assistant", content: final.content });

    if (final.stop_reason !== "tool_use") return;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of final.content) {
      if (block.type === "tool_use") {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: executeTool(block.name, block.input),
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
    process.stdout.write("\n");
  }
};

const main = async () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on("SIGINT", () => {
    console.log("\nBye!");
    rl.close();
    process.exit(0);
  });

  console.log('Chat ready. Type "exit" to quit.\n');

  while (true) {
    const userInput = (await rl.question("You: ")).trim();
    if (!userInput) continue;
    if (userInput.toLowerCase() === "exit") break;

    addUserMessage(userInput);

    process.stdout.write("\nAssistant: ");
    await chat(allMessages);
    process.stdout.write("\n\n");
  }

  rl.close();
};

main();
