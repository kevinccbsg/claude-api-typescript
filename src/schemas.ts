import { z } from "zod";

export const VocabularyItemSchema = z.object({
  word: z.string().describe("The Chinese word in simplified characters"),
  pinyin: z.string().describe("Pinyin romanization with tone marks"),
  meaning: z.string().describe("English meaning of the word"),
});

export const ChineseReplySchema = z.object({
  message: z.string().describe("The conversational reply to show the user"),
  vocabulary: z
    .array(VocabularyItemSchema)
    .describe("Chinese words mentioned in the reply, with pinyin and meaning"),
});

export type ChineseReply = z.infer<typeof ChineseReplySchema>;
export type VocabularyItem = z.infer<typeof VocabularyItemSchema>;
