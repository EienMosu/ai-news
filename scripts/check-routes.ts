// Fails if the set of statically prerendered routes changes.
//
// `pnpm build` succeeding is not evidence the route table is right. A page that reads DynamoDB
// must be server-rendered per request; if it is prerendered instead, the build either hits the
// database with no credentials (a loud failure) or bakes one moment's feed into a static page
// and serves it forever (a silent one). Removing `force-dynamic` from a page today happens to
// change nothing, because Next infers dynamic rendering from `params`/`searchParams` usage --
// so every data route is protected by an inference, not by the directive it appears to rely on.
// The first page that reads data without touching either would go static with the build green.
//
// Run after `pnpm build`. Reads .next/prerender-manifest.json, whose `routes` keys are exactly
// the routes Next prerendered.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Routes that are SUPPOSED to be static. Anything else appearing is a failure; anything here
 *  going missing is too, because that means a static route quietly became dynamic. */
// /icon.svg joined the set with the favicon (Task A3); next prerenders metadata icons.
const EXPECTED_STATIC = ["/_global-error", "/_not-found", "/icon.svg", "/robots.txt"];

export function checkRoutes(manifestPath = ".next/prerender-manifest.json"): number {
  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch {
    console.log(`  FAIL ${manifestPath} not found -- run pnpm build first`);
    return 1;
  }
  const routes = Object.keys((JSON.parse(raw) as { routes?: Record<string, unknown> }).routes ?? {});
  const actual = [...routes].sort();
  const expected = [...EXPECTED_STATIC].sort();

  const unexpected = actual.filter((r) => !expected.includes(r));
  const missing = expected.filter((r) => !actual.includes(r));

  for (const r of unexpected) console.log(`  FAIL ${r} is prerendered and should not be`);
  for (const r of missing) console.log(`  FAIL ${r} was prerendered and no longer is`);
  if (unexpected.length === 0 && missing.length === 0) {
    console.log(`  ok   ${actual.length} static routes, as expected: ${actual.join(", ")}`);
    return 0;
  }
  return unexpected.length + missing.length;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(checkRoutes() === 0 ? 0 : 1);
}
