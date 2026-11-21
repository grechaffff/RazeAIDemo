import Anthropic from "@anthropic-ai/sdk";

/**
 * Claude can be reached directly or through OpenRouter's Anthropic-compatible
 * Messages endpoint. Same SDK, same request format (tools, structured output);
 * only the base URL, the auth header and the model id differ.
 */
const OPENROUTER_BASE_URL = "https://openrouter.ai/api";

// OpenRouter wins when its key is set. Hosts such as Netlify inject their own
// ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL (an AI gateway) into every function,
// so checking the Anthropic key first would silently send requests there.
export const PROVIDER: "anthropic" | "openrouter" | null = process.env.OPENROUTER_API_KEY
  ? "openrouter"
  : process.env.ANTHROPIC_API_KEY
    ? "anthropic"
    : null;

/** A cheap, fast model is enough for the demo; override with LLM_MODEL. */
export const MODEL =
  process.env.LLM_MODEL || (PROVIDER === "openrouter" ? "anthropic/claude-haiku-5.5" : "claude-haiku-5-5");

export class LlmNotConfiguredError extends Error {
  constructor() {
    super("No LLM key is set (ANTHROPIC_API_KEY or OPENROUTER_API_KEY), so rule parsing and the demo agent are off.");
  }
}

/** A short, readable message for an API failure; never an HTML page. */
export function describeApiError(err: unknown): string | null {
  if (!(err instanceof Anthropic.APIError)) return null;
  const raw = err.message.replace(/^\d{3}\s*/, "");
  const detail = raw.trimStart().startsWith("<") ? "" : `: ${raw.slice(0, 200)}`;
  return `Claude API error ${err.status ?? ""} via ${PROVIDER} with model ${MODEL}${detail}`;
}

let cached: Anthropic | undefined;

export function getAnthropic(): Anthropic {
  if (!PROVIDER) throw new LlmNotConfiguredError();
  cached ??=
    PROVIDER === "anthropic"
      ? new Anthropic()
      : new Anthropic({
          baseURL: process.env.OPENROUTER_BASE_URL || OPENROUTER_BASE_URL,
          // OpenRouter expects "Authorization: Bearer", which the SDK sends for authToken.
          apiKey: null,
          authToken: process.env.OPENROUTER_API_KEY,
        });
  return cached;
}
