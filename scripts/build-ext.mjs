import { build } from "esbuild";

const shared = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome114",
  sourcemap: false,
  minify: false,
  legalComments: "none",
  define: {
    "process.env.NODE_ENV": '"production"'
  },
  logLevel: "info"
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/content/main.ts"],
    outfile: "dist/content.js"
  }),
  build({
    ...shared,
    entryPoints: ["src/background/main.ts"],
    outfile: "dist/background.js"
  })
]);
