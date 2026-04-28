import fs from "node:fs";
import path from "node:path";

const LESSONS_DIR = path.resolve("lessons");

export const textEditorTool = {
  type: "text_editor_20250728",
  name: "str_replace_based_edit_tool",
} as const;

const resolveLessonPath = (rawPath: string): string => {
  const stripped = rawPath.replace(/^\/?lessons\/?/, "");
  const resolved = path.resolve(LESSONS_DIR, stripped);
  if (resolved !== LESSONS_DIR && !resolved.startsWith(LESSONS_DIR + path.sep)) {
    throw new Error(`Path outside lessons/ not allowed: ${rawPath}`);
  }
  return resolved;
};

type EditorInput =
  | { command: "view"; path: string; view_range?: [number, number] }
  | { command: "create"; path: string; file_text: string }
  | { command: "str_replace"; path: string; old_str: string; new_str: string }
  | { command: "insert"; path: string; insert_line: number; new_str: string };

export const handleTextEditor = (
  input: unknown,
): { content: string; is_error?: boolean } => {
  try {
    const cmd = input as EditorInput;
    const filePath = resolveLessonPath(cmd.path);

    switch (cmd.command) {
      case "view": {
        if (!fs.existsSync(filePath)) {
          return { content: `Path does not exist: ${cmd.path}`, is_error: true };
        }
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          const entries = fs.readdirSync(filePath);
          return { content: entries.length ? entries.join("\n") : "(empty directory)" };
        }
        const text = fs.readFileSync(filePath, "utf-8");
        const lines = text.split("\n");
        const [start, end] = cmd.view_range ?? [1, lines.length];
        const sliced = lines.slice(start - 1, end === -1 ? undefined : end);
        const numbered = sliced.map((l, i) => `${start + i}\t${l}`).join("\n");
        return { content: numbered };
      }
      case "create": {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, cmd.file_text);
        return { content: `Created ${path.relative(process.cwd(), filePath)}` };
      }
      case "str_replace": {
        const text = fs.readFileSync(filePath, "utf-8");
        const occurrences = text.split(cmd.old_str).length - 1;
        if (occurrences === 0) {
          return { content: `old_str not found in ${cmd.path}`, is_error: true };
        }
        if (occurrences > 1) {
          return {
            content: `old_str appears ${occurrences} times in ${cmd.path} — must be unique. Add more context to old_str.`,
            is_error: true,
          };
        }
        fs.writeFileSync(filePath, text.replace(cmd.old_str, cmd.new_str));
        return { content: `Replaced 1 occurrence in ${path.relative(process.cwd(), filePath)}` };
      }
      case "insert": {
        const text = fs.readFileSync(filePath, "utf-8");
        const lines = text.split("\n");
        if (cmd.insert_line < 0 || cmd.insert_line > lines.length) {
          return {
            content: `insert_line ${cmd.insert_line} out of range (file has ${lines.length} lines)`,
            is_error: true,
          };
        }
        lines.splice(cmd.insert_line, 0, cmd.new_str);
        fs.writeFileSync(filePath, lines.join("\n"));
        return { content: `Inserted at line ${cmd.insert_line} in ${path.relative(process.cwd(), filePath)}` };
      }
    }
  } catch (err) {
    return { content: (err as Error).message, is_error: true };
  }
};
