import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkBrowser } from "./browser-smoke.mjs";

const artifactDirectory = process.env.LOGIFOS_WASM_ARTIFACT;
assert.ok(artifactDirectory, "Set LOGIFOS_WASM_ARTIFACT to the pinned external WASM artifact directory");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "logifos-package-"));
const consumer = join(scratch, "consumer");
mkdirSync(consumer);
const env = { ...process.env, npm_config_cache: process.env.npm_config_cache ?? join(scratch, "npm-cache") };
const npmCommand = process.env.npm_execpath ? process.execPath : "npm";
const npmPrefix = process.env.npm_execpath ? [process.env.npm_execpath] : [];
const npm = (args, cwd) => execFileSync(npmCommand, [...npmPrefix, ...args], {
  cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
});
const [pack] = JSON.parse(npm(["pack", "--json", "--pack-destination", scratch], repo));
const modules = ["browser", "errors", "index", "integrity", "node", "pin", "public", "runtime", "types"];
const expected = ["LICENSE.txt", "README.md", "package.json",
  ...modules.flatMap(name => [`dist/${name}.js`, `dist/${name}.d.ts`])];
assert.deepEqual(pack.files.map(file => file.path).sort(), expected.sort());
writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
npm(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund",
  "--package-lock=false", join(scratch, pack.filename)], consumer);
writeFileSync(join(consumer, "check.mjs"), `
import * as api from "logifos-ts";
import * as nodeApi from "logifos-ts/node";
import * as browserApi from "logifos-ts/browser";
import assert from "node:assert/strict";
import { runtimeCases } from ${JSON.stringify(pathToFileURL(join(repo, "test/runtime-cases.mjs")).href)};
assert.equal(api.initialize, nodeApi.initialize);
await runtimeCases(api, browserApi, ${JSON.stringify(resolve(artifactDirectory))}, ${JSON.stringify(scratch)});
`);
execFileSync(process.execPath, ["--test", join(consumer, "check.mjs")], { cwd: consumer, env, stdio: "inherit" });

writeFileSync(join(consumer, "check.mts"), `
import { initialize, LogifosError, type Capabilities, type SvgResult, type ContractIdentity } from "logifos-ts";
import { initialize as browserInitialize } from "logifos-ts/browser";
const runtime = await initialize({ artifactDirectory: "./artifact" });
const capabilities: Capabilities = await runtime.negotiate();
const contract: ContractIdentity = { origin: "example", revision: "0".repeat(40), schema_path: "formula.json", sha256: "0".repeat(64) };
const rendered: Promise<SvgResult> = runtime.render({}, contract, { fonts: [{ id: "Example", bytes: new Uint8Array([1]) }] });
void rendered;
void capabilities;
void LogifosError;
void browserInitialize({ artifactUrl: "https://example.invalid/wasm/" });
// @ts-expect-error initialization needs an artifact directory
initialize({});
// @ts-expect-error font bytes must be a Uint8Array
runtime.negotiate({ fonts: [{ id: "Example", bytes: "abc" }] });
// @ts-expect-error no PDF output
runtime.render({}, contract, {}, "pdf");
`);
writeFileSync(join(consumer, "browser.mts"), `
import { initialize } from "logifos-ts";
void initialize({ artifactUrl: "https://example.invalid/wasm/" });
// @ts-expect-error browser declarations do not accept filesystem locations
initialize({ artifactDirectory: "./artifact" });
`);
for (const browser of [false, true]) {
  const config = join(consumer, browser ? "tsconfig.browser.json" : "tsconfig.json");
  writeFileSync(config, JSON.stringify({ compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
    strict: true, noEmit: true, types: [], ...(browser ? { customConditions: ["browser"] } : {}),
  }, files: [browser ? "browser.mts" : "check.mts"] }));
  execFileSync(process.execPath, [join(repo, "node_modules/typescript/bin/tsc"), "--project", config],
    { cwd: consumer, env, stdio: "inherit" });
}

// Traverse the installed browser dependency graph, checking every reachable module.
const dist = join(consumer, "node_modules/logifos-ts/dist");
const visited = new Set();
function inspectBrowser(name) {
  if (visited.has(name)) return;
  visited.add(name);
  const source = readFileSync(join(dist, name), "utf8");
  assert.doesNotMatch(source, /(?:node:|\brequire\s*\(|\bprocess\.|\bBuffer\b)/);
  for (const [, specifier] of source.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)) {
    assert.ok(specifier.startsWith("./"), `Unexpected browser dependency ${specifier}`);
    inspectBrowser(specifier.slice(2));
  }
}
inspectBrowser("browser.js");
assert.ok(visited.size >= 5);
assert.ok(!readdirSync(dist).some(name => name.endsWith(".wasm")));
console.log(`Installed declarations and browser dependency graph passed; ${pack.files.length} package files`);
if (process.argv.includes("--browser")) await checkBrowser(consumer, scratch, resolve(artifactDirectory));
