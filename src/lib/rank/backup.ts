export interface BackupDeps {
  fetch: typeof fetch;
  /** Reads the PAT from SSM. Injected so no test needs credentials. */
  getToken: () => Promise<string>;
  repo: string;
}

export interface BackupResult {
  ok: boolean;
  path: string;
  bytes: number;
  error?: string;
}

/**
 * Writes one day as NDJSON to `archive/<day>.ndjson` in the repo.
 *
 * Never throws. A failed backup must not fail the ranking run — the ranked day is already in
 * DynamoDB by the time this is called, and losing it to a GitHub outage would be a strictly
 * worse outcome than having no copy for a day.
 */
export async function backupDay(
  day: string,
  articles: Record<string, unknown>[],
  deps: BackupDeps,
): Promise<BackupResult> {
  const path = `archive/${day}.ndjson`;
  const url = `https://api.github.com/repos/${deps.repo}/contents/${path}`;
  const ndjson = articles.map((a) => JSON.stringify(a)).join("\n") + "\n";

  // Scoped outside the try so the catch can redact it too: a thrown fetch error (sync or
  // async) can carry the token in its own message (e.g. a request-info dump), and that must
  // not escape into a return value that Task 7 logs to CloudWatch. Undefined until getToken()
  // resolves, so redact() is a no-op if getToken() itself is what throws.
  let token: string | undefined;
  const redact = (s: string) => (token ? s.split(token).join("[redacted]") : s);

  try {
    token = await deps.getToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    // A re-run of the same day must overwrite, which the Contents API only allows with the
    // current blob sha. A 404 means this is the first write for the day. Anything else (403
    // rate limit, 500, ...) means we don't actually know whether the file exists — guessing
    // "absent" would send a sha-less PUT against a file that does exist, and GitHub answers
    // that with a 409/422 that looks like a write failure when the real cause was upstream.
    const existing = await deps.fetch(url, { headers });
    let sha: string | undefined;
    if (existing.ok) {
      sha = ((await existing.json()) as { sha?: string }).sha;
    } else if (existing.status !== 404) {
      return {
        ok: false,
        path,
        bytes: 0,
        error: redact(`could not determine existing file state: ${existing.status}`),
      };
    }

    const put = await deps.fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: `archive: ${day}`,
        content: Buffer.from(ndjson, "utf8").toString("base64"),
        ...(sha ? { sha } : {}),
      }),
    });

    if (!put.ok) return { ok: false, path, bytes: 0, error: redact(`GitHub responded ${put.status}`) };
    return { ok: true, path, bytes: Buffer.byteLength(ndjson, "utf8") };
  } catch (e) {
    // Redacted, not just "built from the error's own text": a thrown fetch error can still
    // quote the token back at us verbatim, so the token itself is stripped on the way out.
    return { ok: false, path, bytes: 0, error: redact(e instanceof Error ? e.message : "unknown") };
  }
}
