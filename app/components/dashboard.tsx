"use client";

import { useCallback, useEffect, useState } from "react";
import type { DecisionView, WorkspaceView } from "@/lib/ui";
import { ChatPanel } from "./chat-panel";
import { DecisionLog } from "./decision-log";
import { RulesPanel } from "./rules-panel";
import { TopBar } from "./top-bar";

const POLL_MS = 3000;

type Tab = "rules" | "chat" | "log";

/** The whole demo: rules, agent chat and the decision log, kept in sync by polling. */
export function Dashboard() {
  const [workspace, setWorkspace] = useState<WorkspaceView | null>(null);
  const [decisions, setDecisions] = useState<DecisionView[]>([]);
  const [chatKey, setChatKey] = useState(0);
  // On phones the three columns become tabs.
  const [tab, setTab] = useState<Tab>("chat");
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

  const pending = decisions.filter((d) => d.verdict === "require_approval" && !d.resolution).length;
  // Each column is always mounted (chat history survives tab switches); on phones only the active one shows.
  const pane = (name: Tab) => `min-h-0 flex-col ${tab === name ? "flex flex-1" : "hidden"} lg:flex`;

  return (
    <div className="flex h-dvh flex-col">
      <TopBar name={workspace.name} onReset={reset} />
      {loadError && <div className="bg-block-bg px-4 py-1.5 text-sm text-block lg:px-6">{loadError}</div>}
      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(280px,340px)_1fr_minmax(300px,380px)]">
        <div className={pane("rules")}>
          <RulesPanel rules={workspace.rules} campaigns={workspace.campaigns} onChange={refresh} />
        </div>
        <div className={pane("chat")}>
          <ChatPanel
            key={chatKey}
            campaigns={workspace.campaigns}
            mcpPath={workspace.mcpPath}
            onAction={refresh}
            onOpenLog={() => setTab("log")}
          />
        </div>
        <div className={pane("log")}>
          <DecisionLog decisions={decisions} rules={workspace.rules} onChange={refresh} />
        </div>
      </div>
      <MobileTabs tab={tab} onChange={setTab} pending={pending} />
    </div>
  );
}

function MobileTabs({ tab, onChange, pending }: { tab: Tab; onChange: (t: Tab) => void; pending: number }) {
  const items: { id: Tab; label: string }[] = [
    { id: "rules", label: "Rules" },
    { id: "chat", label: "Agent chat" },
    { id: "log", label: "Decision log" },
  ];
  return (
    <nav className="grid grid-cols-3 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          aria-current={tab === item.id ? "page" : undefined}
          className={`relative py-3 text-sm font-medium ${tab === item.id ? "text-ink" : "text-muted"}`}
        >
          {item.label}
          {item.id === "log" && pending > 0 && (
            <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-approval px-1.5 text-[11px] font-semibold text-white">
              {pending}
            </span>
          )}
          {tab === item.id && <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-ink" />}
        </button>
      ))}
    </nav>
  );
}
