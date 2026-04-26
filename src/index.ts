import Anthropic from "@anthropic-ai/sdk";
import readline from "node:readline/promises";
import { ChineseReplySchema, type ChineseReply } from "./schemas";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod.js";

const client = new Anthropic();
const model = "claude-sonnet-4-6";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const allMessages: Message[] = [];
const storeResponses: Anthropic.Messages.Message[] = [];

const systemPrompt = `
You are a helpful chinese teacher focus on hsk1 hsk2 level for beginners.
You will always give chinese tips of language based on the conversation if it is not about hsk doubts.
`;

const addUserMessage = (text: string) => {
  allMessages.push({ role: "user", content: text });
};

const addAssistantMessage = (text: string) => {
  allMessages.push({ role: "assistant", content: text });
};

const chat = async (messages: Message[]): Promise<string> => {
  let text = "";
  const stream = client.messages.stream({
    model,
    max_tokens: 1000,
    messages,
    system: systemPrompt,
    // output_config: {
    //   format: zodOutputFormat(ChineseReplySchema),
    //   effort: 'low',
    // },
  });
  stream.on("text", (delta) => {
    text += delta;
    process.stdout.write(delta);
  });
  const final = await stream.finalMessage();
  storeResponses.push(final);
  return text;
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
    const assistantText = await chat(allMessages);
    process.stdout.write("\n\n");

    addAssistantMessage(assistantText);
  }

  rl.close();
};

main();
