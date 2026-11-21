"use client";

import { useState } from "react";

export function TopBar({ name, onReset }: { name: string; onReset: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);

  return (
    <header className="flex items-end justify-between gap-3 border-b border-line px-4 pt-4 pb-3 lg:px-6 lg:pt-5 lg:pb-4">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted lg:text-xs">Agent Guardrails · demo</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight lg:text-3xl">{name}</h1>
      </div>
      <div className="flex items-center gap-4">
        <p className="hidden max-w-[420px] text-right text-sm text-muted xl:block">
          Every change the agent proposes is checked against your rules on the server, from chat and from Claude over MCP alike.
        </p>
        <button
          onClick={async () => {
            setBusy(true);
            await onReset();
            setBusy(false);
          }}
          disabled={busy}
          className="shrink-0 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50"
        >
          {busy ? "Resetting…" : "Reset demo"}
        </button>
      </div>
    </header>
  );
}
