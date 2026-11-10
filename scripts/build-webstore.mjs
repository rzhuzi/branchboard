import { cp, lstat, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = resolve(root, "dist");
const output = resolve(root, "dist-webstore");
const config = JSON.parse(await readFile(resolve(root, "webstore.config.json"), "utf8"));
if (typeof config.version !== "string") {
  throw new Error("Chrome Web Store version must be a string in webstore.config.json");
}
const parts = String(config.version).split(".");
if (parts.length > 4 || parts.some((part) => !/^(0|[1-9]\d*)$/.test(part) || Number(part) > 65535) || parts.every((part) => Number(part) === 0)) {
  throw new Error("Invalid Chrome Web Store version in webstore.config.json");
}
const manifest = JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8"));

// Only clean this project's dedicated generated folder, never a linked directory.
if (dirname(output) !== root || basename(output) !== "dist-webstore") {
  throw new Error("Unexpected web store output directory");
}
const existing = await lstat(output).catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
if (existing?.isSymbolicLink() || (existing && !existing.isDirectory())) {
  throw new Error("The web store output must be a regular directory");
}
await rm(output, { recursive: true, force: true });
await cp(source, output, { recursive: true });
manifest.version = config.version;
delete manifest.version_name;
await writeFile(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Web store build ${config.version} prepared in dist-webstore; GitHub build unchanged.`);
