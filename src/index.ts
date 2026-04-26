import Anthropic from "@anthropic-ai/sdk";
import { ContentBlock } from "@anthropic-ai/sdk/resources.mjs";
import readline from "node:readline/promises";

const client = new Anthropic();
const model = "claude-sonnet-4-6";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const userMessages: Message[] = [];
const assistantMessages: Message[] = [];
const allMessages: Message[] = [...userMessages, ...assistantMessages];

const addUserMessage = (text: string): Message[] => {
  userMessages.push({
    role: "user",
    content: text,
  });
  allMessages.push({
    role: "user",
    content: text,
  });
  return allMessages;
};

const addAssistantMessage = (text: string): Message[] => {
  assistantMessages.push({
    role: "assistant",
    content: text,
  });
  allMessages.push({
    role: "assistant",
    content: text,
  });
  return allMessages;
};

const storeResponses: Anthropic.Messages.Message[] = [];

const systemPrompt = `
You are a helpful chinese teacher focus on hsk1 hsk2 level for beginners.
You will always give chinese tips of language based on the conversation if it is not about hsk doubts.
`;

const chat = async (messages: Message[]) => {
  const message = await client.messages.create({
    model,
    max_tokens: 1000,
    messages: messages,
    system: systemPrompt,
  });
  storeResponses.push(message);
  return message;
};

const extractText = (content: ContentBlock[]): string =>
  content
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n");

const printMessages = (messages: ContentBlock[]) => {
  messages.forEach((message) => {
    if (message.type === "text") {
      console.log(message.text);
    }
  });
};

const main = async () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('Chat ready. Type "exit" to quit.\n');

  while (true) {
    const userInput = (await rl.question("You: ")).trim();
    if (!userInput) continue;
    if (userInput.toLowerCase() === "exit") break;

    addUserMessage(userInput);
    const response = await chat(allMessages);
    const assistantText = extractText(response.content);
    addAssistantMessage(assistantText);

    console.log(`\nAssistant: ${assistantText}\n`);
  }

  rl.close();
};

main();




