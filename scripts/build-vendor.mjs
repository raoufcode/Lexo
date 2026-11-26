// Bundles the official Anthropic SDK into a single classic script usable by the
// extension background (Chrome service worker via importScripts, Firefox event page).
// Output: vendor/anthropic-sdk.js  ->  globalThis.Anthropic
import { build } from "esbuild";

await build({
  stdin: {
    contents: `import Anthropic from "@anthropic-ai/sdk"; globalThis.Anthropic = Anthropic;`,
    resolveDir: process.cwd(),
    loader: "js",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome110", "firefox115"],
  minify: true,
  legalComments: "eof",
  outfile: "vendor/anthropic-sdk.js",
});
console.log("vendor/anthropic-sdk.js built");
