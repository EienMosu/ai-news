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

  it("falls back to urlHash when cluster id is blank and counts it", () => {
    const r = reconcile([h(1), h(2)], {
      items: [item(h(1), { clusterId: "" }), item(h(2), { clusterId: "  " })],
    });
    expect(r.matched).toBe(2);
    expect(r.withoutCluster).toBe(2);
    expect(r.byHash.get(h(1))?.clusterId).toBe(`__self__:${h(1)}`);
    expect(r.byHash.get(h(2))?.clusterId).toBe(`__self__:${h(2)}`);
  });

  it("falls back to urlHash when cluster id is missing and counts it", () => {
    const r = reconcile([h(1)], { items: [item(h(1), { clusterId: undefined })] });
    expect(r.matched).toBe(1);
    expect(r.withoutCluster).toBe(1);
    expect(r.byHash.get(h(1))?.clusterId).toBe(`__self__:${h(1)}`);
  });

  it("counts entries with missing or blank rationale separately", () => {
    const r = reconcile([h(1), h(2), h(3)], {
      items: [
        item(h(1), { whyItMatters: "" }),
        item(h(2), { whyItMatters: "  " }),
        item(h(3), { whyItMatters: "Real reason" }),
      ],
    });
    expect(r.matched).toBe(3);
    expect(r.withoutRationale).toBe(2);
    expect(r.byHash.get(h(1))?.whyItMatters).toBe(null);
    expect(r.byHash.get(h(2))?.whyItMatters).toBe(null);
    expect(r.byHash.get(h(3))?.whyItMatters).toBe("Real reason");
  });

  it("counts entries with missing rationale as withoutRationale", () => {
    const r = reconcile([h(1)], { items: [item(h(1), { whyItMatters: undefined })] });
    expect(r.matched).toBe(1);
    expect(r.withoutRationale).toBe(1);
    expect(r.byHash.get(h(1))?.whyItMatters).toBe(null);
  });

  it("treats numeric-string importance as a type violation and skips the entry", () => {
    const r = reconcile([h(1)], { items: [item(h(1), { importance: "85" })] });
    expect(r.matched).toBe(0);
    expect(r.missing).toBe(1);
    expect(r.byHash.has(h(1))).toBe(false);
  });

  it("treats boolean importance as a type violation and skips the entry", () => {
    const r = reconcile([h(1)], { items: [item(h(1), { importance: true })] });
    expect(r.matched).toBe(0);
    expect(r.missing).toBe(1);
    expect(r.byHash.has(h(1))).toBe(false);
  });

  it("keeps first match when response contains duplicate urlHash", () => {
    const r = reconcile([h(1)], {
      items: [
        item(h(1), { importance: 80, clusterId: "first" }),
        item(h(1), { importance: 90, clusterId: "second" }),
      ],
    });
    expect(r.matched).toBe(1);
    expect(r.byHash.get(h(1))?.importance).toBe(80);
    expect(r.byHash.get(h(1))?.clusterId).toBe("first");
  });

  it("handles input with duplicate hashes correctly", () => {
    const r = reconcile([h(1), h(1), h(2)], {
      items: [item(h(1)), item(h(2))],
    });
    expect(r.matched).toBe(2);
    expect(r.missing).toBe(0);
  });

  it("clamps Infinity to 100 and -Infinity to 0", () => {
    const r = reconcile([h(1), h(2)], {
      items: [
        item(h(1), { importance: Infinity }),
        item(h(2), { importance: -Infinity }),
      ],
    });
    expect(r.byHash.get(h(1))?.importance).toBe(100);
    expect(r.byHash.get(h(2))?.importance).toBe(0);
  });

  it("stores and preserves clusterId and whyItMatters values", () => {
    const r = reconcile([h(1)], {
      items: [item(h(1), { clusterId: "cluster-42", whyItMatters: "Breaking story" })],
    });
    expect(r.byHash.get(h(1))?.clusterId).toBe("cluster-42");
    expect(r.byHash.get(h(1))?.whyItMatters).toBe("Breaking story");
  });

  it("fallback cluster id is disjoint from model-supplied ids even when model uses article hashes", () => {
    const r = reconcile([h(1), h(2)], {
      items: [
        item(h(1), { clusterId: "" }),
        item(h(2), { clusterId: h(1) }),
      ],
    });
    expect(r.matched).toBe(2);
    expect(r.withoutCluster).toBe(1);
    expect(r.byHash.get(h(1))?.clusterId).toBe(`__self__:${h(1)}`);
    expect(r.byHash.get(h(2))?.clusterId).toBe(h(1));
    expect(r.byHash.get(h(1))?.clusterId).not.toBe(r.byHash.get(h(2))?.clusterId);
  });
});
