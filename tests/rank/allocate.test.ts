import { describe, expect, it } from "vitest";
import { allocateRankingCap, type ScoredCandidate } from "../../src/lib/rank/allocate.js";
import { RANK_INPUT_CAP } from "../../src/lib/rank/model.js";

interface Item {
  section: string;
  score: number;
}

/** `item` doubles as the scored candidate's payload so tests can inspect `.section`/`.score`
 *  on the values `allocateRankingCap` returns, without a separate lookup table. */
const make = (section: string, count: number, startScore: number): ScoredCandidate<Item>[] =>
  Array.from({ length: count }, (_, i) => {
    const score = startScore - i;
    return { item: { section, score }, section, score };
  });

const bySection = (items: Item[], section: string) => items.filter((i) => i.section === section);

describe("allocateRankingCap", () => {
  it("gives the whole cap to a single section", () => {
    // Only "design" has any candidates -- there is no other section to share the cap with.
    const design = make("design", 5, 50); // scores 50,49,48,47,46
    const cap = 3;
    const result = allocateRankingCap(design, cap);

    // Mutation: deleting the `rest.push(...)` line (dropping whatever a section didn't get
    // selected, instead of keeping it for the tail) would shrink this result to 3 items
    // instead of 5 -- the two unselected candidates would vanish rather than merely sort
    // after the selected three.
    const selected = result.slice(0, cap);
    expect(selected.map((i) => i.score)).toEqual([50, 49, 48]);
    expect(result).toHaveLength(5);
  });

  it("splits the cap evenly between two sections with plenty of candidates each", () => {
    const ai = make("ai", 10, 10); // scores 10..1
    const design = make("design", 10, 20); // scores 20..11
    const cap = 6;
    const result = allocateRankingCap([...ai, ...design], cap);

    // Mutation: replacing `Math.floor(remainingCap / remainingGroups)` with
    // `remainingCap` (i.e. letting whichever section is processed first take everything)
    // would give one section all 6 slots and the other 0, instead of 3/3.
    const selected = result.slice(0, cap);
    expect(bySection(selected, "ai")).toHaveLength(3);
    expect(bySection(selected, "design")).toHaveLength(3);
    expect(bySection(selected, "ai").map((i) => i.score).sort((a, b) => b - a)).toEqual([10, 9, 8]);
    expect(bySection(selected, "design").map((i) => i.score).sort((a, b) => b - a)).toEqual([20, 19, 18]);
  });

  it("redistributes a smaller section's unused remainder to sections that still have candidates", () => {
    // Three sections, not two: with exactly two sections a smaller section's whole supply
    // ends up contiguous with the larger one regardless of the split point, so slicing the
    // combined list "self-heals" and can no longer tell a fair split from a naive one -- a
    // third section is what actually makes an unfair split observable here.
    const design = make("design", 5, 100); // far short of any plausible share
    const ai = make("ai", 50, 1000);
    const video = make("video", 50, 900);
    const cap = 20;
    const result = allocateRankingCap([...design, ...ai, ...video], cap);

    // Correct (water-filling): design's equal share is floor(20/3)=6 but it only has 5, so it
    // takes all 5 (nothing wasted on it); the unused 1 slot returns to the pool. ai then sees
    // floor(15/2)=7 and takes 7; video sees floor(8/1)=8 and takes 8. Total 5+7+8=20.
    //
    // Mutation: replacing `Math.floor(remainingCap / remainingGroups)` with a FIXED
    // `Math.floor(cap / groups.length)` (i.e. no redistribution -- every section's share is
    // computed from the original cap and group count, never from what's left) gives
    // design=5, ai=6, video=6 officially (only 17 total, 3 wasted); the 3 unused cap slots
    // then spill onto whichever section's leftovers sit first in the returned list, giving
    // ai=9 and video=6 instead of the fair ai=7/video=8 -- still failing this assertion.
    const selected = result.slice(0, cap);
    expect(bySection(selected, "design")).toHaveLength(5);
    expect(bySection(selected, "ai")).toHaveLength(7);
    expect(bySection(selected, "video")).toHaveLength(8);
    expect(selected).toHaveLength(20);
  });

  it("caps each section at its equal share when both have more candidates than that share", () => {
    const ai = make("ai", 150, 1000);
    const design = make("design", 150, 900);
    const cap = 200;
    const result = allocateRankingCap([...ai, ...design], cap);

    // Mutation: changing `const take = Math.min(group.length, share);` to `const take =
    // group.length;` (ignoring the computed share and always taking everything a section
    // has) would give each section all 150 of its candidates instead of 100.
    const selected = result.slice(0, cap);
    expect(bySection(selected, "ai")).toHaveLength(100);
    expect(bySection(selected, "design")).toHaveLength(100);
  });

  it("never selects more than the cap, including with an uneven remainder across three sections", () => {
    const a = make("a", 1000, 1000);
    const b = make("b", 1000, 1000);
    const c = make("c", 1000, 1000);
    const cap = 10; // not evenly divisible by 3
    const result = allocateRankingCap([...a, ...b, ...c], cap);
    const selected = result.slice(0, cap);

    // Mutation: dropping the `remainingCap -= take` decrement (so every group computes its
    // share from the ORIGINAL cap instead of what's left) would allocate 3+3+3=9 here but
    // could exceed the cap in other shapes, and more directly would break the redistribution
    // test above; the assertion actually pinned here is the exact 3/3/4 split floor(10/3)
    // produces once each later group's share is computed from the shrinking remainder.
    expect(bySection(selected, "a")).toHaveLength(3);
    expect(bySection(selected, "b")).toHaveLength(3);
    expect(bySection(selected, "c")).toHaveLength(4);
    expect(selected.length).toBeLessThanOrEqual(cap);
  });

  it("never pads the selection past the total supply, and keeps each section's own score order, when every section combined is under the cap", () => {
    const ai = make("ai", 2, 5); // scores 5, 4
    const design = make("design", 3, 9); // scores 9, 8, 7
    const result = allocateRankingCap([...ai, ...design], 200);

    // `Array.slice` clamps rather than overruns, so a `take` that exceeds `group.length`
    // (e.g. from a bad Math.min/Math.max swap) produces no observable difference here --
    // this asserts something a mutation can actually be shown to break instead: reversing the
    // per-group sort comparator from `(a, b) => b.score - a.score` to `(a, b) => a.score -
    // a.score`'s mirror, `(a, b) => a.score - b.score`, would return each section's items
    // worst-first instead of best-first, which the exact score order below catches even
    // though the per-section COUNTS would stay 2 and 3 either way.
    expect(result).toHaveLength(5);
    expect(bySection(result, "ai").map((i) => i.score)).toEqual([5, 4]);
    expect(bySection(result, "design").map((i) => i.score)).toEqual([9, 8, 7]);
  });

  it("never zeroes a nonempty section purely from rounding, when cap is smaller than the section count", () => {
    // Fix 12 (final review, axis 2): unreachable at today's cap of 200 against 2 sections, but
    // plain integer division (`Math.floor(remainingCap / remainingGroups)`) can floor a
    // nonempty group's share to exactly 0 well before the cap is actually exhausted -- e.g.
    // cap=2 split three ways: the two smallest groups would each compute floor(2/3)=0 and
    // floor(2/2)=0, leaving the entire cap to whichever group is processed last.
    const a = make("a", 1, 100);
    const b = make("b", 1, 100);
    const c = make("c", 5, 100);
    const cap = 2;
    const result = allocateRankingCap([...a, ...b, ...c], cap);
    const selected = result.slice(0, cap);

    // Mutation: reverting `Math.max(share, guaranteed)` to plain `share` makes section "a"
    // (the first, smallest group processed) take 0 instead of 1 -- the entire cap goes to "b"
    // and "c" purely from processing order, even though "a" has a candidate and cap remains.
    expect(bySection(selected, "a")).toHaveLength(1);
    expect(selected).toHaveLength(2);
  });

  it("places every selected candidate before every leftover one, so a slice(0, cap) backstop selects exactly the fair share", () => {
    const design = make("design", 65, 1000);
    const ai = make("ai", 170, 900);
    const result = allocateRankingCap([...design, ...ai], 200);

    // Mutation: returning `[...rest, ...selected]` instead of `[...selected, ...rest]` would
    // put the 35 unselected (lowest-scoring) AI candidates FIRST, so rankArticles's own
    // `slice(0, RANK_INPUT_CAP)` backstop would select the wrong 200 -- the leftovers instead
    // of the fair share -- while this test's counts would flip to design=0, ai=200 in the
    // first-200 window.
    const first200 = result.slice(0, 200);
    const last35 = result.slice(200);
    expect(bySection(first200, "design")).toHaveLength(65);
    expect(bySection(first200, "ai")).toHaveLength(135);
    expect(last35).toHaveLength(35);
    expect(bySection(last35, "ai")).toHaveLength(35);
  });

  it("honors the production RANK_INPUT_CAP (375), splitting it evenly across three sections of equal supply", () => {
    // The cap was raised from 250 to 375 when the Cloud vertical shipped (spec
    // theslowwire-design.md §5.1): allocateRankingCap already splits fairly by section (no
    // change there), so a third vertical without a matching cap raise would have quietly cut
    // ai and design's own fair share too. 375 across 3 sections keeps every section's share at
    // 125 -- the same per-section share ai and design already had at the old 250/2-section
    // cap. 200 candidates per section is deliberately more than any section's 125 share, so
    // every section's selection is bounded by the SHARE, not by its own supply -- exactly the
    // boundary this constant exists to police.
    const ai = make("ai", 200, 1000);
    const design = make("design", 200, 900);
    const cloud = make("cloud", 200, 800);
    const result = allocateRankingCap([...ai, ...design, ...cloud], RANK_INPUT_CAP);
    const selected = result.slice(0, RANK_INPUT_CAP);

    // Mutation: reverting the export in src/lib/rank/model.ts from `RANK_INPUT_CAP = 375` back
    // to `250` makes `RANK_INPUT_CAP` read 250 here too (it's the same import), so
    // `selected.length` becomes 250 instead of 375 and each section's share drops from 125 to
    // roughly 83 -- wrong on every assertion below.
    expect(RANK_INPUT_CAP).toBe(375);
    expect(selected).toHaveLength(375);
    expect(bySection(selected, "ai")).toHaveLength(125);
    expect(bySection(selected, "design")).toHaveLength(125);
    expect(bySection(selected, "cloud")).toHaveLength(125);
    // The allocator never hands out more than the cap, even once every section's fair share
    // and its own full supply are both accounted for.
    expect(result).toHaveLength(600);
    expect(selected.length).toBeLessThanOrEqual(RANK_INPUT_CAP);
  });
});
