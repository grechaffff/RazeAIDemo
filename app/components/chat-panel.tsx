"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentAction } from "@/lib/llm/agent";
import { ACTION_LABEL, VERDICT_LABEL, VERDICT_STYLE, actionRecord, formatState, money, type CampaignView } from "@/lib/ui";

type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; actions: AgentAction[] }
  | { role: "notice"; content: string };

/** The demo steps 3–5 from SPEC.md, one click each. */
const SUGGESTIONS = [
  "Lower bids on Retargeting by 10%",
  "Increase Prospecting budget by $80/day",
  "Pause Brand Search, it's too expensive",
];

export function ChatPanel({
  campaigns,
  mcpPath,
  onAction,
  onOpenLog,
}: {
  campaigns: CampaignView[];
  mcpPath: string;
  onAction: () => Promise<void>;
  onOpenLog: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  // Braces matter: newer browsers return a Promise from scrollIntoView, and an
  // effect must not return anything but a cleanup function.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const next: Message[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setBusy(true);

    const history = next
      .filter((m): m is Exclude<Message, { role: "notice" }> => m.role !== "notice")
      .map((m) => ({
        role: m.role,
        content: ((m.content || "(no text)") + (m.role === "assistant" ? actionRecord(m.actions) : "")).slice(0, 2000),
      }))
      .slice(-20);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      const body = await res.json().catch(() => ({ error: `The server returned an empty answer (HTTP ${res.status}).` }));
      if (!res.ok) throw new Error(body.error ?? "The agent did not answer.");
      setMessages((m) => [...m, { role: "assistant", content: body.reply, actions: body.actions }]);
      await onAction();
    } catch (err) {
      setMessages((m) => [...m, { role: "notice", content: (err as Error).message }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col lg:border-x lg:border-line">
      <ConnectToClaude mcpPath={mcpPath} />
      <CampaignStrip campaigns={campaigns} />

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 lg:px-6 lg:py-5">
        {messages.length === 0 && (
          <div className="mx-auto max-w-md pt-8 text-center">
            <h2 className="text-xl font-semibold">Ask the agent to change a campaign</h2>
            <p className="mt-1.5 text-sm text-muted">
              It can change budgets and bids, pause and resume. Each change goes through the rules on the left.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <ChatMessage key={i} message={m} onOpenLog={onOpenLog} />
        ))}
        {busy && <p className="text-sm text-muted">Agent is working…</p>}
        <div ref={bottom} />
      </div>

      <div className="border-t border-line bg-card px-4 py-3 lg:px-6 lg:py-4">
        <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              disabled={busy}
              className="shrink-0 rounded-full border border-line bg-page px-3 py-1 text-sm whitespace-nowrap hover:border-ink/40 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Tell the agent what to change…"
            className="min-w-0 flex-1 rounded-full border border-line bg-white px-4 py-2.5 text-base focus:border-ink/50 focus:outline-none lg:text-[15px]"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white hover:bg-black disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>
    </section>
  );
}

function ChatMessage({ message, onOpenLog }: { message: Message; onOpenLog: () => void }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-[15px] text-white lg:max-w-[75%]">{message.content}</p>
      </div>
    );
  }
  if (message.role === "notice") {
    return <p className="rounded-xl border border-block/30 bg-block-bg px-4 py-2.5 text-sm text-block">{message.content}</p>;
  }
  return (
    <div className="space-y-2.5 lg:max-w-[85%]">
      {message.actions.map((a) => (
        <ActionCard key={a.actionId} action={a} onOpenLog={onOpenLog} />
      ))}
      {message.content && (
        <p className="rounded-2xl rounded-bl-md border border-line bg-card px-4 py-2.5 text-[15px] whitespace-pre-wrap">
          {message.content}
        </p>
      )}
    </div>
  );
}

/** Before/after card with the verdict colour, shown for every change the agent proposed. */
function ActionCard({ action, onOpenLog }: { action: AgentAction; onOpenLog: () => void }) {
  const style = VERDICT_STYLE[action.verdict];
  return (
    <div className={`rounded-xl border bg-card p-3.5 ${style.border}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">
          {ACTION_LABEL[action.actionType]} · {action.campaign.name}
        </span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.bg} ${style.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
          {VERDICT_LABEL[action.verdict]}
        </span>
      </div>
      <div className="mt-2.5 flex items-center gap-3 font-mono text-[15px]">
        <span className="text-muted">{formatState(action.actionType, action.before)}</span>
        <span className="text-muted">→</span>
        <span className={action.applied ? "font-semibold" : "text-muted line-through decoration-1"}>
          {formatState(action.actionType, action.after)}
        </span>
      </div>
      {action.verdict !== "allow" && <p className={`mt-2 text-sm ${style.text}`}>{action.reason}</p>}
      {action.verdict === "require_approval" && (
        <button onClick={onOpenLog} className="mt-2 text-sm font-medium underline underline-offset-2 lg:hidden">
          Approve or deny in the decision log
        </button>
      )}
    </div>
  );
}

function ConnectToClaude({ mcpPath }: { mcpPath: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? mcpPath : `${window.location.origin}${mcpPath}`;

  return (
    <div className="flex items-center gap-3 border-b border-line bg-card px-4 py-2.5 text-sm lg:px-6">
      <span className="shrink-0 font-medium">
        <span className="hidden sm:inline">Connect to </span>Claude
      </span>
      <code className="min-w-0 flex-1 truncate rounded-md bg-page px-2 py-1 font-mono text-xs text-muted" title={url}>
        {url}
      </code>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="shrink-0 rounded-full bg-ink px-3 py-1 text-xs font-medium text-white hover:bg-black"
      >
        {copied ? "Copied" : "Copy MCP URL"}
      </button>
    </div>
  );
}

function CampaignStrip({ campaigns }: { campaigns: CampaignView[] }) {
  return (
    <div className="grid grid-cols-2 border-b border-line lg:grid-cols-4">
      {campaigns.map((c, i) => (
        <div
          key={c.id}
          className={`px-4 py-2 lg:py-2.5 ${i % 2 === 0 ? "border-r border-line" : ""} ${i < 2 ? "border-b border-line lg:border-b-0" : ""} lg:border-r lg:last:border-r-0`}
        >
          <p className="truncate text-xs font-medium" title={c.name}>
            {c.name}
          </p>
          <p className="mt-0.5 font-mono text-xs text-muted">
            {money(c.dailyBudgetUsd)}/day · bid {money(c.bidUsd)}
          </p>
          <p
            className={`mt-0.5 text-[11px] font-medium ${c.status === "active" ? "hidden text-allow lg:block" : "text-muted"}`}
          >
            {c.status === "active" ? "● Active" : "○ Paused"} · {c.platform === "google" ? "Google" : "Meta"}
          </p>
        </div>
      ))}
    </div>
  );
}
