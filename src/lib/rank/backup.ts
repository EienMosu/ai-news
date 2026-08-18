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

  try {
    const token = await deps.getToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    // A re-run of the same day must overwrite, which the Contents API only allows with the
    // current blob sha. Absent (404) means this is the first write for the day.
    const existing = await deps.fetch(url, { headers });
    const sha = existing.ok ? ((await existing.json()) as { sha?: string }).sha : undefined;

    const put = await deps.fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: `archive: ${day}`,
        content: Buffer.from(ndjson, "utf8").toString("base64"),
        ...(sha ? { sha } : {}),
      }),
    });

    if (!put.ok) return { ok: false, path, bytes: 0, error: `GitHub responded ${put.status}` };
    return { ok: true, path, bytes: Buffer.byteLength(ndjson, "utf8") };
  } catch (e) {
    // The message is built from the error's own text, never from the token.
    return { ok: false, path, bytes: 0, error: e instanceof Error ? e.message : "unknown" };
  }
}
