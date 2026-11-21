"use client";

import { useCallback, useEffect, useState } from "react";
import type { DecisionView, WorkspaceView } from "@/lib/ui";
import { ChatPanel } from "./chat-panel";
import { DecisionLog } from "./decision-log";
import { RulesPanel } from "./rules-panel";
import { TopBar } from "./top-bar";

const POLL_MS = 3000;

/** The whole demo: rules, agent chat and the decision log, kept in sync by polling. */
export function Dashboard() {
  const [workspace, setWorkspace] = useState<WorkspaceView | null>(null);
  const [decisions, setDecisions] = useState<DecisionView[]>([]);
  const [chatKey, setChatKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [ws, log] = await Promise.all([
        fetch("/api/workspace", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/decisions", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setWorkspace(ws);
      setDecisions(log.decisions);
      setLoadError(null);
    } catch {
      setLoadError("Could not reach the server. Retrying…");
    }
  }, []);

  useEffect(() => {
    // Changes can arrive from Claude over MCP at any time, so keep polling.
    // The first call runs on the next tick so state is never set during the effect itself.
    const first = setTimeout(refresh, 0);
    const id = setInterval(refresh, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);

  const reset = async () => {
    await fetch("/api/reset", { method: "POST" });
    setChatKey((k) => k + 1);
    await refresh();
  };

  if (!workspace) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted">{loadError ?? "Setting up your demo workspace…"}</div>
    );
  }

  return (
    <div className="flex h-screen min-w-[1180px] flex-col">
      <TopBar name={workspace.name} onReset={reset} />
      {loadError && <div className="bg-block-bg px-6 py-1.5 text-sm text-block">{loadError}</div>}
      <div className="grid min-h-0 flex-1 grid-cols-[340px_1fr_380px]">
        <RulesPanel rules={workspace.rules} campaigns={workspace.campaigns} onChange={refresh} />
        <ChatPanel key={chatKey} campaigns={workspace.campaigns} mcpPath={workspace.mcpPath} onAction={refresh} />
        <DecisionLog decisions={decisions} rules={workspace.rules} onChange={refresh} />
      </div>
    </div>
  );
}
