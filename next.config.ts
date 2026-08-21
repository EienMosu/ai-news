import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: "tsconfig.app.json",
  },

  // This project is ESM with `"type": "module"`, so every relative import inside `src/` ends
  // in `.js` even though the file on disk is `.ts` -- required by `node --experimental-strip-types`,
  // which runs the scripts, and by the resolve hook in scripts/register-ts-extension-resolve-hook.mjs.
  //
  // Turbopack resolves those specifiers literally and cannot find `read.js` next to `read.ts`,
  // so a server component importing the feed layer fails with "Module not found". Turbopack
  // parses `extensionAlias` and then ignores it -- verified against Next 16.3.1 by building
  // with it set and watching the same error. webpack honours it. Hence --webpack in the dev
  // and build scripts: it is the only one of the two that can see src/.
  //
  // The alternative, confirmed to work end-to-end in review, is to drop the `.js` suffix from
  // the imports the app reaches (about a dozen lines across five files) and teach the Node
  // loader hook to resolve extensionless specifiers. That keeps Turbopack, which is Next's
  // default and where its future work goes. It was not taken because converting only the
  // files the app happens to reach leaves `src/` with two import conventions and no rule
  // saying which applies where -- a trap for whoever edits it next. Two of the five are
  // app-only (`read.ts`, `shape.ts`); the rest are shared with the deployed capture and rank
  // Lambdas, so a partial conversion also splits a directory those functions build from.
  // Converting the whole tree is a much larger change than this one.
  //
  // Revisit if Turbopack gains `extensionAlias`, or if a future Next major drops --webpack.
  // At that point the extensionless conversion becomes the cheaper of the two.
  experimental: {
    extensionAlias: { ".js": [".ts", ".tsx", ".js"] },
  },

  /*
    Security headers. The live responses carried only HSTS (Vercel's own), so the audit on
    2026-08-21 found CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy and
    Permissions-Policy all absent.

    The CSP is written from what this app actually does, not from a template:
    - `default-src 'none'` first, so anything not named below is refused outright.
    - `img-src https: data:` is the one wide directive and it has to be: article thumbnails come
      from whatever host published the story, an open set by nature. `http:` is deliberately NOT
      allowed, so a feed offering an insecure image gets no mixed-content request.
    - `style-src 'unsafe-inline'`: next/font injects an inline style block. The app's own inline
      style tag is gone (the overscroll ground moved to a `:has()` rule in globals.css), so this
      is Next's need, not ours.
    - `script-src 'self' 'unsafe-inline'`: this app ships zero client components, but Next still
      emits its inline bootstrap. Nothing loads script from another origin.
    - `frame-ancestors 'none'` plus `X-Frame-Options: DENY` say the same thing twice on purpose:
      the header covers browsers that ignore the directive.
    - `form-action 'self'`: the Others filter is a GET form; it must never be retargetable.
    - `object-src 'none'`, `base-uri 'none'`: no plugins, and no injected `<base>` able to
      re-point every relative URL on the page.
  */
  async headers() {
    const csp = [
      "default-src 'none'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https: data:",
      "font-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
