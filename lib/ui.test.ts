import { describe, expect, it } from "vitest";
import { actionRecord } from "./ui";

describe("actionRecord", () => {
  it("is empty when nothing was submitted", () => {
    expect(actionRecord([])).toBe("");
  });

  it("states what the server did in earlier turns", () => {
    const text = actionRecord([
      {
        actionType: "bid_change",
        campaign: { name: "Retargeting" },
        before: { value: 1.2 },
        after: { value: 1.08 },
        verdict: "allow",
        applied: true,
      },
    ]);
    expect(text).toContain("Retargeting: $1.20 → $1.08, applied");
    expect(text).toContain("[Server record of this turn");
  });
});
