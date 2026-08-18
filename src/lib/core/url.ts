import { createHash } from "node:crypto";

const TRACKING_PREFIXES = ["utm_", "at_"];
const TRACKING_EXACT = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref",
  "source",
]);

/**
 * Canonical URL form. urlHash is the item's primary key, so two spellings of
 * the same article must normalize identically or the archive grows duplicates.
 */
export function normalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }

  u.hostname = u.hostname.toLowerCase();
  u.protocol = u.protocol.toLowerCase();
  u.hash = "";

  for (const key of [...u.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (TRACKING_EXACT.has(lower) || TRACKING_PREFIXES.some((p) => lower.startsWith(p))) {
      u.searchParams.delete(key);
    }
  }

  let out = u.toString();
  if (out.endsWith("?")) out = out.slice(0, -1);
  if (out.endsWith("/") && new URL(out).pathname !== "/") out = out.slice(0, -1);
  return out;
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function urlHash(normalized: string): string {
  return sha256(normalized);
}

/**
 * Identity fallback for sources whose links are opaque redirect wrappers we
 * failed to resolve — notably the Google News RSS fallback used for Anthropic
 * (spec §3).
 */
export function titleHash(title: string, sourceName: string): string {
  return sha256(`${title.trim().toLowerCase()}|${sourceName}`);
}
