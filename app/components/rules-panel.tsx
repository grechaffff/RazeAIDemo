"use client";

import { useEffect, useRef, useState } from "react";
import { describeRule } from "@/lib/rules/describe";
import type { RuleDefinition } from "@/lib/rules/schema";
import type { CampaignView, RuleView } from "@/lib/ui";

type Preview =
  | { kind: "rule"; rule: RuleDefinition; description: string }
  | { kind: "question"; question: string }
  | { kind: "error"; error: string };

const EXAMPLE = "Never change bids by more than 20%";

export function RulesPanel({
  rules,
  campaigns,
  onChange,
}: {
  rules: RuleView[];
  campaigns: CampaignView[];
  onChange: () => Promise<void>;
}) {
  // Bring a newly saved rule into view.
  const list = useRef<HTMLOListElement>(null);
  const count = useRef(rules.length);
  useEffect(() => {
    if (rules.length > count.current) list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
    count.current = rules.length;
  }, [rules.length]);

  return (
    <aside className="flex min-h-0 flex-col bg-panel text-white">
      <div className="px-5 pt-5 pb-3">
        <h2 className="text-lg font-semibold">Rules</h2>
        <p className="mt-0.5 text-sm text-white/55">Written in plain English, enforced by code.</p>
      </div>
      <ol ref={list} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 pb-4">
        {rules.map((rule) => (
          <RuleCard key={rule.id} rule={rule} campaigns={campaigns} onChange={onChange} />
        ))}
      </ol>
      <AddRule onSaved={onChange} />
    </aside>
  );
}

function RuleCard({ rule, campaigns, onChange }: { rule: RuleView; campaigns: CampaignView[]; onChange: () => Promise<void> }) {
  // Optimistic while the request runs; the server value wins after the refresh.
  const [pending, setPending] = useState<boolean | null>(null);
  const enabled = pending ?? rule.enabled;
  const definition = { ...rule, source_text: rule.sourceText } as unknown as RuleDefinition;

  const toggle = async () => {
    setPending(!enabled);
    await fetch("/api/rules", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: rule.id, enabled: !enabled }),
    });
    await onChange();
    setPending(null);
  };

  return (
    <li className={`rounded-xl border border-panel-line bg-panel-2 px-3.5 py-3 transition-opacity ${enabled ? "" : "opacity-45"}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 font-mono text-xs text-white/40">#{rule.position}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-snug font-medium">{rule.sourceText}</p>
          <p className="mt-1 text-xs leading-relaxed text-white/55">
            <OutcomeTag outcome={rule.outcome} /> {describeRule(definition, campaigns)}
          </p>
        </div>
        <Switch on={enabled} onClick={toggle} label={`Rule #${rule.position} ${enabled ? "on" : "off"}`} />
      </div>
    </li>
  );
}

function OutcomeTag({ outcome }: { outcome: RuleView["outcome"] }) {
  return outcome === "block" ? (
    <span className="mr-1 inline-block rounded-full bg-block/25 px-1.5 text-[11px] font-medium text-[#ffb4ab]">Blocks</span>
  ) : (
    <span className="mr-1 inline-block rounded-full bg-approval/30 px-1.5 text-[11px] font-medium text-[#f6cf7f]">Approval</span>
  );
}

function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-allow" : "bg-white/20"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

function AddRule({ onSaved }: { onSaved: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setPreview(null);
    const res = await fetch("/api/rules/parse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const body = await res.json().catch(() => ({ kind: "error", error: "Unexpected server response." }));
    setPreview(body.kind ? body : { kind: "error", error: body.error ?? "Something went wrong." });
    setBusy(false);
  };

  const save = async (rule: RuleDefinition) => {
    setBusy(true);
    const res = await fetch("/api/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rule }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setPreview({ kind: "error", error: body.error ?? "Could not save the rule." });
      return;
    }
    setText("");
    setPreview(null);
    await onSaved();
  };

  return (
    <div className="border-t border-panel-line p-5">
      <label htmlFor="new-rule" className="text-sm font-medium">
        Add a rule in plain English
      </label>
      <textarea
        id="new-rule"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            check();
          }
        }}
        rows={2}
        placeholder={EXAMPLE}
        className="mt-2 w-full resize-none rounded-lg border border-panel-line bg-panel-2 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:border-white/40 focus:outline-none"
      />

      {preview?.kind === "rule" && (
        <div className="mt-2 rounded-lg border border-white/15 bg-white/5 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-white/45">How the agent understood it</p>
          <p className="mt-1 text-sm">{preview.description}</p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => save(preview.rule)}
              disabled={busy}
              className="rounded-full bg-white px-3.5 py-1.5 text-sm font-medium text-ink hover:bg-white/90 disabled:opacity-50"
            >
              Save rule
            </button>
            <button onClick={() => setPreview(null)} className="rounded-full px-3 py-1.5 text-sm text-white/70 hover:text-white">
              Edit
            </button>
          </div>
        </div>
      )}
      {preview?.kind === "question" && (
        <p className="mt-2 rounded-lg bg-approval/25 px-3 py-2 text-sm text-[#f6cf7f]">{preview.question} Edit the rule and check again.</p>
      )}
      {preview?.kind === "error" && <p className="mt-2 rounded-lg bg-block/25 px-3 py-2 text-sm text-[#ffb4ab]">{preview.error}</p>}

      {preview?.kind !== "rule" && (
        <div className="mt-2 flex items-center justify-between gap-2">
          {text ? (
            <span />
          ) : (
            <button onClick={() => setText(EXAMPLE)} className="truncate text-left text-xs text-white/45 hover:text-white/80">
              Try: “{EXAMPLE}”
            </button>
          )}
          <button
            onClick={check}
            disabled={busy || !text.trim()}
            className="shrink-0 rounded-full bg-white px-3.5 py-1.5 text-sm font-medium text-ink hover:bg-white/90 disabled:opacity-40"
          >
            {busy ? "Reading…" : "Preview"}
          </button>
        </div>
      )}
    </div>
  );
}
