// Fresh Logifos package-consumer check, licensed under MIT.
import assert from "node:assert/strict";
import { checkBrowser } from "./browser-smoke.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "logifos-package-"));
const consumer = join(scratch, "consumer");
mkdirSync(consumer);
const env = {
  ...process.env,
  npm_config_cache: process.env.npm_config_cache ?? join(scratch, "npm-cache"),
};
const npmCommand = process.env.npm_execpath ? process.execPath : "npm";
const npmPrefix = process.env.npm_execpath ? [process.env.npm_execpath] : [];
const npm = (args, cwd) => execFileSync(npmCommand, [...npmPrefix, ...args], {
  cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
});

console.log(`Package consumer scratch: ${scratch}`);
// prepack must emit the distributable even when dist did not exist beforehand.
const [pack] = JSON.parse(npm(["pack", "--json", "--pack-destination", scratch], repo));
const expectedFiles = [
  "LICENSE.txt", "README.md", "dist/index.d.ts", "dist/index.js", "package.json",
];
assert.deepEqual(pack.files.map(({ path }) => path).sort(), expectedFiles.sort());
writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
npm([
  "install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund",
  "--package-lock=false", join(scratch, pack.filename),
], consumer);

writeFileSync(join(consumer, "check.mjs"), `
import assert from "node:assert/strict";
import { render, NotImplementedError } from "logifos-ts";
assert.equal(typeof render, "function");
assert.equal(typeof NotImplementedError, "function");
for (const args of [[{}], [{}, "svg"], [{}, "png"]]) {
  assert.throws(() => render(...args), error =>
    error instanceof NotImplementedError && error instanceof Error &&
    error.message.includes("the logifos engine boundary lands in P5"));
}
console.log("Installed package: 3 typed refusal cases passed");
`);
execFileSync(process.execPath, [join(consumer, "check.mjs")], { cwd: consumer, env, stdio: "inherit" });

writeFileSync(join(consumer, "check.mts"), `
import { render, NotImplementedError } from "logifos-ts";
const output: Uint8Array = render({});
const refusal: Error = new NotImplementedError("pending");
render({}, "svg");
render({}, "png");
// @ts-expect-error only SVG and PNG are part of the public signature
render({}, "pdf");
// @ts-expect-error rendering returns bytes, not a string
const text: string = render({});
void [output, refusal, text];
`);
writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
    strict: true, noEmit: true, types: [],
  },
  files: ["check.mts"],
}));
execFileSync(process.execPath, [
  join(repo, "node_modules", "typescript", "bin", "tsc"),
  "--project", join(consumer, "tsconfig.json"),
], { cwd: consumer, env, stdio: "inherit" });
console.log(`Installed declarations: positive and negative type checks passed; ${pack.files.length} package files`);

if (process.argv.includes("--browser")) {
  await checkBrowser(consumer, scratch);
}
