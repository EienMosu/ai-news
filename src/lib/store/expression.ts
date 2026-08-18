/**
 * Accumulates a DynamoDB SET expression with every attribute name aliased.
 *
 * Three invariants, all from spec §4:
 *   - null/undefined values are dropped, never written. A degraded run must refresh what it
 *     knows without destroying enrichment it does not know.
 *   - `setIfAbsent` emits `if_not_exists`, which is what pins an article to the first day it
 *     was seen. Without it a second day's write moves the GSI1 entry and the article
 *     disappears from the earlier day's archive.
 *   - a non-finite number (NaN, +/-Infinity) throws instead of writing. NaN passes the
 *     null/undefined guard and would otherwise reach the AWS SDK's marshall() and explode
 *     there with no attribute name attached. A NaN score is reachable today (a corrupted
 *     stored `firstSeenAt` makes computeScore's fallback Date.parse produce NaN all the way
 *     through), and buildSortKey clamps separately, so a silent drop here would leave
 *     `gsi1sk: "0000#<hash>"` written while `score` silently vanished -- two attributes
 *     disagreeing about the same number. Throwing at the write boundary, where the attribute
 *     name is known, is what keeps that failure loud instead of vanishing into an SDK stack
 *     trace nobody reads.
 */
export function updateBuilder() {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  let n = 0;

  const alias = (attr: string, value: unknown) => {
    const nk = `#n${n}`;
    const vk = `:v${n}`;
    n += 1;
    names[nk] = attr;
    values[vk] = value;
    return { nk, vk };
  };

  const rejectNonFinite = (attr: string, value: unknown) => {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error(`updateBuilder: refusing to write non-finite value for "${attr}"`);
    }
  };

  return {
    set(attr: string, value: unknown) {
      if (value === null || value === undefined) return;
      rejectNonFinite(attr, value);
      const { nk, vk } = alias(attr, value);
      sets.push(`${nk} = ${vk}`);
    },
    setIfAbsent(attr: string, value: unknown) {
      if (value === null || value === undefined) return;
      rejectNonFinite(attr, value);
      const { nk, vk } = alias(attr, value);
      sets.push(`${nk} = if_not_exists(${nk}, ${vk})`);
    },
    build() {
      if (sets.length === 0) throw new Error("updateBuilder: refusing to build an empty update");
      return {
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      };
    },
  };
}
