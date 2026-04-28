import Anthropic from "@anthropic-ai/sdk";
import readline from "node:readline/promises";
import { ChineseReplySchema, type ChineseReply } from "./schemas";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod.js";
import { getSystemTime, getSystemTimeTool } from "./tools";
import { handleTextEditor, textEditorTool } from "./lesson-tools";

const client = new Anthropic();
const model = "claude-sonnet-4-6";

const allMessages: Anthropic.MessageParam[] = [];
const storeResponses: Anthropic.Messages.Message[] = [];

const systemPrompt = `
You are a helpful chinese teacher focus on hsk1 hsk2 level for beginners.
You will always give chinese tips of language based on the conversation if it is not about hsk doubts.

You can save and edit lessons as markdown files using the str_replace_based_edit_tool.
Lessons live in the lessons/ folder (paths are relative to it). When the user asks to
save, view, or update a lesson, use the tool — pick descriptive filenames like
"hsk1/numbers.md" or "greetings.md". Use 'create' for new files, 'view' to read or list,
'str_replace' for targeted edits, and 'insert' to add content at a specific line.
`;

const addUserMessage = (text: string) => {
  allMessages.push({ role: "user", content: text });
};

const executeTool = (
  name: string,
  input: unknown,
): { content: string; is_error?: boolean } => {
  try {
    if (name === "get_system_time") {
      return { content: JSON.stringify(getSystemTime()) };
    }
    if (name === "str_replace_based_edit_tool") {
      return handleTextEditor(input);
    }
    return { content: `Unknown tool: ${name}`, is_error: true };
  } catch (err) {
    return { content: (err as Error).message, is_error: true };
  }
};

const chat = async (messages: Anthropic.MessageParam[]): Promise<void> => {
  while (true) {
    const stream = client.messages.stream({
      model,
      max_tokens: 1000,
      messages,
      system: systemPrompt,
      tools: [getSystemTimeTool, textEditorTool],
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
        const result = executeTool(block.name, block.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result.content,
          is_error: result.is_error,
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
