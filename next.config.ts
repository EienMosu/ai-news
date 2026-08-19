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
  experimental: {
    extensionAlias: { ".js": [".ts", ".tsx", ".js"] },
  },
};

export default nextConfig;
