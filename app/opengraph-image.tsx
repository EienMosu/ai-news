import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * The share card. Before this, a pasted link previewed as nothing; a product asking to look
 * professional cannot ship a blank card. Statically prerendered (no per-request cost), one
 * image for every route -- per-article cards would multiply Bedrock-adjacent cost for a
 * one-reader product, spec's cost constraint says no.
 *
 * The Bricolage extra-bold cut ships in the repo (assets/, OFL licence): satori needs raw font
 * bytes, next/font's build pipeline does not expose them, and fetching Google Fonts at render
 * time would make the build depend on a third party.
 */
export const alt = "The Slow Wire";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const display = await readFile(
    join(process.cwd(), "assets", "BricolageGrotesque-ExtraBold.ttf"),
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px 96px",
          backgroundColor: "#151512",
          color: "#efe9dc",
          fontFamily: "Bricolage",
        }}
      >
        {/* the folded-corner file, drawn at card scale */}
        <svg width="88" height="88" viewBox="0 0 26 26">
          <path d="M4 3h11l7 7v13H4z" fill="none" stroke="#efe9dc" strokeWidth="2" />
          <path d="M15 3v7h7" fill="none" stroke="#efe9dc" strokeWidth="2" />
        </svg>
        <div style={{ fontSize: 110, letterSpacing: "-0.04em", marginTop: 36, display: "flex" }}>
          The Slow Wire
        </div>
        <div
          style={{
            fontSize: 34,
            marginTop: 24,
            opacity: 0.8,
            display: "flex",
            letterSpacing: "0.01em",
          }}
        >
          Each day&rsquo;s news, ranked by importance, not recency.
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 56 }}>
          {[
            { label: "AI", bg: "#16307f" },
            { label: "DESIGN", bg: "#7e2412" },
            { label: "CLOUD", bg: "#1a432b" },
          ].map((w) => (
            <div
              key={w.label}
              style={{
                display: "flex",
                backgroundColor: w.bg,
                color: "#efe9dc",
                padding: "10px 26px",
                fontSize: 26,
                letterSpacing: "0.12em",
              }}
            >
              {w.label}
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Bricolage", data: display, weight: 800, style: "normal" }],
    },
  );
}
