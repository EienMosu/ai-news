import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The caching contract, pinned at the source level because unstable_cache only runs inside
 * Next's runtime (unit suites see a pass-through stub; see tests/stubs/next-cache.ts).
 *
 * Two rules carry the whole design:
 * 1. Every exported store read is the WRAPPED constant, so no route can import an uncached
 *    variant by accident.
 * 2. No wrapped function's signature may carry a Date or a "now" parameter: unstable_cache
 *    keys on arguments, and a per-request timestamp in the key defeats the cache silently,
 *    which no test that calls the function twice could ever notice from inside the stub.
 */
describe("the data cache contract", () => {
  const read = readFileSync("src/lib/feed/read.ts", "utf8");
  const archive = readFileSync("src/lib/search/archive.ts", "utf8");

  const WRAPPED = ["getDay", "getArticle", "getArchive", "getRunStatus"];

  it("exports the single-key store reads as wrapped constants", () => {
    for (const fn of WRAPPED) {
      expect(read, fn).toContain(`export const ${fn} = unstable_cache(${fn}Uncached`);
      expect(read, `${fn} must not leak an uncached export`).not.toContain(
        `export async function ${fn}(`,
      );
    }
    expect(archive).toContain("export const fetchArchiveDay = unstable_cache(fetchArchiveDayUncached");
  });

  it("caches the feed at the day level, never keyed on section", () => {
    // Keyed on (section, count), /design and /cloud re-ran identical day Queries into their own
    // entries and a section switch missed the cache. The primitives carry the cache; the
    // composition must stay unwrapped.
    expect(read).toContain('unstable_cache(\n  async (count: number) => listDays(');
    expect(read).toContain('unstable_cache(\n  async (day: string) => queryDay(');
    expect(read).not.toContain("unstable_cache(getRecentDaysUncached");
    expect(read).toMatch(/export async function getRecentDays\(section: Section/);
  });

  it("keeps request-scoped time out of every cached signature", () => {
    for (const src of [read, archive]) {
      for (const m of src.matchAll(/async function (\w+Uncached)\(([^)]*)\)/g)) {
        expect(m[2], `${m[1]} carries request-scoped time in its cache key`).not.toMatch(
          /now|Date/,
        );
      }
    }
  });

  it("splits the TTLs as designed: heavy 3600, run-status 300, archive 86400", () => {
    expect(read).toContain("HEAVY_READ_TTL_SECONDS = 3600");
    expect(read).toContain("RUN_STATUS_TTL_SECONDS = 300");
    expect(read).toMatch(/getRunStatusUncached[\s\S]{0,400}RUN_STATUS_TTL_SECONDS/);
    expect(archive).toContain("revalidate: 86_400");
  });
});
