import Anthropic from "@anthropic-ai/sdk";

export interface SystemTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  iso: string;
}

export const getSystemTime = (): SystemTime => {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes(),
    iso: now.toISOString(),
  };
};

export const getSystemTimeTool: Anthropic.Tool = {
  name: "get_system_time",
  description:
    "Returns the current system date and time broken down into year, month, day, hour, minute, plus a full ISO 8601 string. Use whenever you need to know the current date or time.",
  input_schema: {
    type: "object",
    properties: {},
  },
};
