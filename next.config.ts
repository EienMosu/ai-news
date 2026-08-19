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
  // default and where its future work goes. It was not taken because those five files are
  // shared with the deployed capture and rank Lambdas, and because converting only the files
  // the app happens to reach leaves `src/` with two import conventions and no rule saying
  // which applies where -- a trap for whoever edits it next. Converting the whole tree is a
  // much larger change than this one.
  //
  // Revisit if Turbopack gains `extensionAlias`, or if a future Next major drops --webpack.
  // At that point the extensionless conversion becomes the cheaper of the two.
  experimental: {
    extensionAlias: { ".js": [".ts", ".tsx", ".js"] },
  },
};

export default nextConfig;
