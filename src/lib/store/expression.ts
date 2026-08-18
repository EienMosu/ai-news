/**
 * Accumulates a DynamoDB SET expression with every attribute name aliased.
 *
 * Two invariants, both from spec §4:
 *   - null/undefined values are dropped, never written. A degraded run must refresh what it
 *     knows without destroying enrichment it does not know.
 *   - `setIfAbsent` emits `if_not_exists`, which is what pins an article to the first day it
 *     was seen. Without it a second day's write moves the GSI1 entry and the article
 *     disappears from the earlier day's archive.
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

  return {
    set(attr: string, value: unknown) {
      if (value === null || value === undefined) return;
      const { nk, vk } = alias(attr, value);
      sets.push(`${nk} = ${vk}`);
    },
    setIfAbsent(attr: string, value: unknown) {
      if (value === null || value === undefined) return;
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
