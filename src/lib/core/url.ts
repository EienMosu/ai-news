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
    // Fix 3: protocol-relative links like //example.com/post
    // Gate strictly: exactly // followed by non-slash to avoid fabricating hosts from paths
    if (/^\/\/[^/]/.test(raw)) {
      try {
        u = new URL(`https:${raw}`);
      } catch {
        return raw;
      }
    } else {
      return raw;
    }
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

  // Fix 1: strip trailing slashes from pathname before serializing
  if (u.pathname !== "/") u.pathname = u.pathname.replace(/\/+$/, "");

  let out = u.toString();
  if (out.endsWith("?")) out = out.slice(0, -1);
  return out;
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * The identity form of a URL: what we hash to decide "is this the same article".
 * Deliberately more aggressive than normalizeUrl, because this value is never
 * shown to anyone — it only has to be stable across spellings of one article.
 */
function canonicalize(normalized: string): string {
  let u: URL;
  try {
    u = new URL(normalized);
  } catch {
    return normalized;
  }
  u.protocol = "https:";
  u.hostname = u.hostname.replace(/^www\./, "");
  u.searchParams.sort();
  return u.toString();
}

export function urlHash(normalized: string): string {
  return sha256(canonicalize(normalized));
}

/**
 * Identity fallback for sources whose links are opaque redirect wrappers we
 * failed to resolve — notably the Google News RSS fallback used for Anthropic
 * (spec §3).
 */
export function titleHash(title: string, sourceName: string): string {
  return sha256(`${title.trim().toLowerCase()}|${sourceName}`);
}
