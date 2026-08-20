import { describe, expect, it } from "vitest";
import robots from "../../app/robots.js";

/**
 * Final review, L1: this file had zero tests before -- `grep -rn robots tests` found nothing --
 * and it is the only cost control on `/search`, the one route that costs up to `RECENT_WINDOW_DAYS`
 * `queryDay` Queries plus, once `?since=` is in the URL, an archive fetch, on every uncached hit.
 * Mutation-proven: changing `disallow: "/search"` to anything else (or dropping it) used to leave
 * `pnpm test`, `pnpm typecheck`, `pnpm build` and `pnpm check:routes` all green, because nothing
 * asserted on the actual rule this file returns.
 */
describe("robots", () => {
  it("disallows exactly /search for every user agent", () => {
    expect(robots().rules).toEqual({ userAgent: "*", disallow: "/search" });
  });

  it("does not disallow the whole site -- the feed and story routes must stay crawlable", () => {
    const { rules } = robots();
    const ruleList = Array.isArray(rules) ? rules : [rules];
    for (const rule of ruleList) {
      expect(rule.disallow).not.toBe("/");
      expect(rule.disallow).not.toBeUndefined();
    }
  });
});
