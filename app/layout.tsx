import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Bricolage_Grotesque, JetBrains_Mono, Literata } from "next/font/google";

// Self-hosted at build time by next/font. Three roles, three faces, and each one earns its place:
// the display grotesque does the talking, Literata is a face designed for reading at length
// (every entry carries prose), and the mono is apparatus — filing times, counts, scores — which
// is data in columns, not a costume for "technical".
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "800"],
  variable: "--font-bricolage",
  display: "swap",
});
const text = Literata({
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
  variable: "--font-literata",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  /* Absolute URLs for og:image and friends. VERCEL_PROJECT_PRODUCTION_URL tracks the project
     through renames, so the coming theslowwire rename needs no edit here; the localhost
     fallback only ever serves local builds. */
  metadataBase: new URL(
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000",
  ),
  title: "The Slow Wire",
  description: "Each day’s news, ranked by importance, not recency.",
};

//
// THE DIRECTION CONTRACT -- what this build committed to, and what it refused.
// Not rendered: a JSX comment is stripped at compile time. The shipped record of this
// world is DESIGN.md.
//
// THESIS: The Slow Wire
// A day that was judged, shown as the file it was judged in. Refuses the reader's
// default arrangement -- a white page of same-size cards sorted by recency -- because this
// product's whole claim is that something read the day and ranked it, and a card list
// hides the ranking inside an order nobody can see.
// AMENDMENT (2026-08-21): The paper grid was removed for a cleaner sheet; the shadow does
// the lifting instead.
// AMENDMENT (2026-08-21): The masthead dropped one step so the section switch reads as
// the primary axis.
// AMENDMENT (2026-08-21): A third colour world, deep pine, shipped for the Cloud
// vertical; the ranking cap rose to 375 so every vertical keeps its fair share.
// OWN-WORLD: Three drenched colour worlds, one per vertical: ink blue #16307f for AI,
// vermilion #7e2412 for design, deep pine #1a432b for cloud, each carrying a clean bone
// paper sheet (#efe9dc). Bricolage Grotesque display, Literata prose, JetBrains Mono
// apparatus. State is a boxed mono STAMP, never a hue, because red is invisible on
// vermilion.
// STORY: The reader sees the day was closed and counted, scans entries at one fixed size,
// notices the lead entry because it left the paper, and opens two or three.
// FIRST VIEWPORT: An ink status rail sits above the field, outside every colour world. On
// the field: the brand row (mark, wordmark and tagline left, Search right), then the
// full-width section switch, then the quick-filter row, then a clear break before the
// first day sheet. That sheet floats below all of it: date large in display, ranked count
// and COMPLETE/PARTIAL stamped in mono beside it, entries as numbered rows. The lead entry
// alone sits on the field, inverted: rank shows as ground, not as scale.
// FORM: The Day's Dossier, pinned by the user from Mosby's Files and The Matter of
// Design, overriding roll 017543fa (which assigned candidate 7, Proceedings Index).
// FINISH: unreviewed and undocumented is unfinished; this build ends with the finish
// review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
//
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${text.variable} ${mono.variable}`}>
      <body>
        {children}
      </body>
    </html>
  );
}
