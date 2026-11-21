import Anthropic from "@anthropic-ai/sdk";

/** A cheap, fast model is enough for the demo; override with ANTHROPIC_MODEL. */
export const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";

export class LlmNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set, so rule parsing and the demo agent are off.");
  }
}

let cached: Anthropic | undefined;

export function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new LlmNotConfiguredError();
  cached ??= new Anthropic();
  return cached;
}
