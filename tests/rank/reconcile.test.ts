import { describe, expect, it } from "vitest";
import { reconcile } from "../../src/lib/rank/reconcile.js";

const h = (n: number) => String(n).padStart(64, "0");

const item = (hash: string, extra: Record<string, unknown> = {}) => ({
  urlHash: hash,
  clusterId: "c1",
  importance: 80,
  whyItMatters: "Because.",
  ...extra,
});

describe("reconcile", () => {
  it("matches returned items to input hashes", () => {
    const r = reconcile([h(1), h(2)], { items: [item(h(1)), item(h(2))] });
    expect(r.matched).toBe(2);
    expect(r.missing).toBe(0);
    expect(r.byHash.get(h(1))?.importance).toBe(80);
  });

  it("counts inputs the model omitted", () => {
    const r = reconcile([h(1), h(2), h(3)], { items: [item(h(1))] });
    expect(r.matched).toBe(1);
    expect(r.missing).toBe(2);
    expect(r.byHash.has(h(2))).toBe(false);
  });

  it("drops hashes that were never sent", () => {
    const r = reconcile([h(1)], { items: [item(h(1)), item(h(9))] });
    expect(r.unknown).toBe(1);
    expect(r.byHash.has(h(9))).toBe(false);
  });

  it("clamps importance outside 0-100", () => {
    const r = reconcile([h(1), h(2)], {
      items: [item(h(1), { importance: 150 }), item(h(2), { importance: -20 })],
    });
    expect(r.byHash.get(h(1))?.importance).toBe(100);
    expect(r.byHash.get(h(2))?.importance).toBe(0);
  });

  it("skips entries with a non-numeric importance", () => {
    const r = reconcile([h(1)], { items: [item(h(1), { importance: "high" })] });
    expect(r.matched).toBe(0);
    expect(r.missing).toBe(1);
  });

  it("treats a malformed response as a total miss rather than throwing", () => {
    expect(reconcile([h(1)], null).missing).toBe(1);
    expect(reconcile([h(1)], { items: "nope" }).missing).toBe(1);
  });
});
