import Anthropic from "@anthropic-ai/sdk";
import { ContentBlock } from "@anthropic-ai/sdk/resources.mjs";

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

const chat = async (messages: Message[]) => {
  console.log(messages);
  
  const message = await client.messages.create({
    model,
    max_tokens: 1000,
    messages: messages,
  });
  storeResponses.push(message);
  return message;
};

const printMessages = (messages: ContentBlock[]) => {
  messages.forEach((message) => {
    if (message.type === "text") {
      console.log(message.text);
    }
  });
};

const main = async () => {
  addUserMessage("What is a function in JavaScript? Answer in one sentence.");
  addAssistantMessage("A function in JavaScript is a reusable block of code that performs a specific task and can be called with different inputs to return a result.");
  addUserMessage("can you repeat that?");
  const message = await chat(allMessages);
  printMessages(message.content);
  storeResponses.forEach((response, index) => {
    console.log(`Response ${index + 1}:`);
    console.log(response.content);
  });
};

main();




