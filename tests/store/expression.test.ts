import { describe, expect, it } from "vitest";
import { updateBuilder } from "../../src/lib/store/expression.js";

describe("updateBuilder", () => {
  it("refuses to write NaN through set(), naming the attribute", () => {
    const b = updateBuilder();
    expect(() => b.set("score", NaN)).toThrow(/score/);
  });

  it("refuses to write Infinity through set(), naming the attribute", () => {
    const b = updateBuilder();
    expect(() => b.set("score", Infinity)).toThrow(/score/);
  });

  it("refuses a non-finite value through setIfAbsent() too, naming the attribute", () => {
    // The score field on capture is guarded with setIfAbsent, not set -- the throw must fire
    // on both paths, not just the one that happened to be tested first.
    const b = updateBuilder();
    expect(() => b.setIfAbsent("score", -Infinity)).toThrow(/score/);
  });

  it("still writes a finite zero rather than treating it as non-finite", () => {
    const b = updateBuilder();
    b.set("score", 0);
    const cmd = b.build();
    expect(Object.values(cmd.ExpressionAttributeValues)).toContain(0);
  });
});
