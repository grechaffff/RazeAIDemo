import { afterEach, describe, expect, it, vi } from "vitest";

const KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "OPENROUTER_API_KEY", "LLM_MODEL"] as const;

async function loadWith(env: Partial<Record<(typeof KEYS)[number], string>>) {
  vi.resetModules();
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  return import("./client");
}

describe("LLM provider choice", () => {
  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
  });

  it("prefers OpenRouter even when the host injects its own Anthropic gateway variables (Netlify)", async () => {
    const { PROVIDER, MODEL } = await loadWith({
      ANTHROPIC_API_KEY: "netlify-placeholder",
      ANTHROPIC_BASE_URL: "https://gateway.example/anthropic",
      OPENROUTER_API_KEY: "sk-or-x",
    });
    expect(PROVIDER).toBe("openrouter");
    expect(MODEL).toBe("anthropic/claude-haiku-5.5");
  });

  it("uses Anthropic directly when only its key is set", async () => {
    const { PROVIDER, MODEL } = await loadWith({ ANTHROPIC_API_KEY: "sk-ant-x" });
    expect(PROVIDER).toBe("anthropic");
    expect(MODEL).toBe("claude-haiku-5-5");
  });

  it("is off without any key", async () => {
    const { PROVIDER, getAnthropic } = await loadWith({});
    expect(PROVIDER).toBeNull();
    expect(() => getAnthropic()).toThrow(/No LLM key/);
  });
});
