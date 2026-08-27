import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { JetBrains_Mono, Literata, Playfair_Display } from "next/font/google";

// Self-hosted at build time by next/font. Three roles, three faces: Playfair Display is the
// high-contrast Didone that carries the masthead and every headline (Modern Classic's voice),
// Literata is a face designed for reading at length (every entry carries prose), and the mono
// is apparatus — filing times, counts, scores — which is data in columns, not a costume for
// "technical".
const display = Playfair_Display({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-playfair",
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

/*
  The theme script — the app's ONE deliberate exception to "zero client components", and it is
  not a component: ~20 lines of vanilla JS, inlined synchronously before content so an explicit
  choice never flashes the wrong theme. It stamps data-theme from localStorage (absent = follow
  the system), and delegates clicks from any [data-theme-toggle] button. The button's label is
  CSS-driven (globals.css .theme-toggle), so SSR stays honest without hydration tricks.
*/
const THEME_SCRIPT = `
(function () {
  var KEY = "theme";
  try {
    var saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    }
  } catch (e) {}
  document.addEventListener("click", function (event) {
    var toggle = event.target && event.target.closest && event.target.closest("[data-theme-toggle]");
    if (!toggle) return;
    var root = document.documentElement;
    var current = root.getAttribute("data-theme");
    if (current !== "light" && current !== "dark") {
      current = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    var next = current === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem(KEY, next); } catch (e) {}
  });
})();
`;

//
// THE DIRECTION CONTRACT -- what this build committed to, and what it refused.
// Not rendered: a JSX comment is stripped at compile time. The shipped record of this
// world is DESIGN.md.
//
// THESIS: The Slow Wire
// A day that was judged, shown as the journal it was published in. Rank is position and
// the lead's gold announcement, never scale; every entry keeps one type size.
// AMENDMENT (2026-08-27, owner redesign): MODERN CLASSIC replaced the Day's Dossier.
// The three colour worlds retired on the web -- one ivory page (true-dark twin), ink
// type, gold as the single accent. Sections became a departments bar ("AI News /
// Design News / Cloud News", no counts) framed by hairlines under the masthead; the
// quick-filter row gained a search field; a labeled Dark/Light pill sits in the util
// row. Playfair Display took the display role from Bricolage Grotesque. The visual
// contract is the direction gallery's "final-design" version.
// STORY: The reader sees the day was closed and counted, scans entries at one fixed
// size, notices the lead under its gold rule, and opens two or three.
// FINISH: unreviewed and undocumented is unfinished; DESIGN.md follows the shipped code.
//
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${text.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
