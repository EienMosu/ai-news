/** One scored candidate, tagged with the section it belongs to. */
export interface ScoredCandidate<T> {
  item: T;
  section: string;
  score: number;
}

/**
 * Splits the ranking cap fairly across sections instead of a single global sort-and-slice.
 *
 * Two measured facts make the global sort unfair: design articles top out at a 0.7 source
 * weight (news) while an AI `lab` announcement reaches 1.0, so design news is outranked by
 * construction rather than by merit; and on a busy AI day (measured: ~65 design + ~170 AI
 * against a 200 cap) a global slice would squeeze design out of the ranked set entirely,
 * leaving it stuck at its degraded capture score with no `whyItMatters`.
 *
 * Each section with at least one candidate gets `floor(cap / sectionCount)`. A section with
 * fewer candidates than its share takes only what it has; the unused remainder is handed back
 * to sections that still have candidates left. Smallest section processed first ("water
 * filling") so its leftover, if any, is available to redistribute to the sections after it.
 *
 * Returns EVERY candidate, not just the selected ones: the fair-share selection comes first,
 * sorted by score descending within each section, followed by whatever didn't fit. That keeps
 * `rankArticles`'s own `slice(0, RANK_INPUT_CAP)` backstop selecting exactly the fair share,
 * and keeps its `truncated` count (candidates.length - selected.length) accurate.
 */
export function allocateRankingCap<T>(scored: ScoredCandidate<T>[], cap: number): T[] {
  const bySection = new Map<string, ScoredCandidate<T>[]>();
  for (const s of scored) {
    const group = bySection.get(s.section);
    if (group) group.push(s);
    else bySection.set(s.section, [s]);
  }

  const groups = [...bySection.values()];
  for (const group of groups) group.sort((a, b) => b.score - a.score);
  groups.sort((a, b) => a.length - b.length);

  let remainingCap = cap;
  let remainingGroups = groups.length;
  const takes = new Map<ScoredCandidate<T>[], number>();
  for (const group of groups) {
    const share = Math.floor(remainingCap / remainingGroups);
    const take = Math.min(group.length, share);
    takes.set(group, take);
    remainingCap -= take;
    remainingGroups -= 1;
  }

  const selected: T[] = [];
  const rest: T[] = [];
  for (const group of groups) {
    const take = takes.get(group) ?? 0;
    selected.push(...group.slice(0, take).map((s) => s.item));
    rest.push(...group.slice(take).map((s) => s.item));
  }
  return [...selected, ...rest];
}
