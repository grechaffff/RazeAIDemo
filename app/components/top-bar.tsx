"use client";

import { useState } from "react";

export function TopBar({ name, onReset }: { name: string; onReset: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);

  return (
    <header className="flex items-end justify-between border-b border-line px-6 pt-5 pb-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Agent Guardrails · demo workspace</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{name}</h1>
      </div>
      <div className="flex items-center gap-4">
        <p className="max-w-[420px] text-right text-sm text-muted">
          Every change the agent proposes is checked against your rules on the server, from chat and from Claude over MCP alike.
        </p>
        <button
          onClick={async () => {
            setBusy(true);
            await onReset();
            setBusy(false);
          }}
          disabled={busy}
          className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50"
        >
          {busy ? "Resetting…" : "Reset demo"}
        </button>
      </div>
    </header>
  );
}
