"use client";

import { useState } from "react";
import {
  ACTION_LABEL,
  CHANNEL_LABEL,
  VERDICT_LABEL,
  VERDICT_STYLE,
  formatState,
  timeOf,
  type DecisionView,
  type RuleView,
} from "@/lib/ui";

export function DecisionLog({
  decisions,
  rules,
  onChange,
}: {
  decisions: DecisionView[];
  rules: RuleView[];
  onChange: () => Promise<void>;
}) {
  return (
    <aside className="flex min-h-0 flex-1 flex-col">
      <div className="px-5 pt-5 pb-3">
        <h2 className="text-lg font-semibold">Decision log</h2>
        <p className="mt-0.5 text-sm text-muted">Every check, newest first. Updates by itself.</p>
      </div>
      <ol className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-5 pb-5">
        {decisions.length === 0 && (
          <li className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
            Nothing yet. Ask the agent for a change, here or from Claude over MCP.
          </li>
        )}
        {decisions.map((d) => (
          <Entry key={d.id} decision={d} rules={rules} onChange={onChange} />
        ))}
      </ol>
    </aside>
  );
}

function Entry({ decision: d, rules, onChange }: { decision: DecisionView; rules: RuleView[]; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const style = VERDICT_STYLE[d.verdict];
  const pending = d.verdict === "require_approval" && !d.resolution;
  const positions = d.matchedRuleIds
    .map((id) => rules.find((r) => r.id === id)?.position)
    .filter((p): p is number => p !== undefined);

  const resolve = async (decision: "approve" | "deny") => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/decisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: d.id, decision }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Could not save the decision.");
    await onChange();
    setBusy(false);
  };

  return (
    <li className={`rounded-xl border bg-card p-3.5 ${pending ? "border-approval/50 shadow-sm" : "border-line"}`}>
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.bg} ${style.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
          {VERDICT_LABEL[d.verdict]}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide ${
            d.channel === "mcp" ? "bg-ink text-white" : "bg-page text-muted"
          }`}
        >
          {CHANNEL_LABEL[d.channel]}
        </span>
        {positions.map((p) => (
          <span key={p} className="font-mono text-[11px] text-muted">
            #{p}
          </span>
        ))}
        <span className="ml-auto font-mono text-[11px] text-muted">{timeOf(d.createdAt)}</span>
      </div>

      <p className="mt-2 text-sm font-medium">
        {ACTION_LABEL[d.actionType]} · {d.campaignName}
      </p>
      <p className="mt-0.5 font-mono text-[13px] text-muted">
        {formatState(d.actionType, d.before)} → {formatState(d.actionType, d.after)}
      </p>
      {d.verdict !== "allow" && <p className="mt-1.5 text-[13px] leading-snug">{d.explanation}</p>}

      {pending && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => resolve("approve")}
            disabled={busy}
            className="rounded-full bg-ink px-3.5 py-1.5 text-sm font-medium text-white hover:bg-black disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={() => resolve("deny")}
            disabled={busy}
            className="rounded-full border border-line px-3.5 py-1.5 text-sm font-medium hover:border-ink/40 disabled:opacity-50"
          >
            Deny
          </button>
        </div>
      )}
      {d.resolution && d.resolvedAt && (
        <p className="mt-2 text-xs text-muted">
          {d.resolution === "approved" ? "Approved" : "Denied"} by {d.resolvedBy} at {timeOf(d.resolvedAt)}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-block">{error}</p>}
    </li>
  );
}
