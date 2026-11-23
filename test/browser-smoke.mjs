import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";

export async function checkBrowser(consumer, scratch, artifactDirectory) {
  const page = `<!doctype html><body><script type="module">
import { initialize, LogifosError } from "/dist/browser.js";
try {
  const pending = initialize({ artifactUrl: new URL("/artifact/", location.href) });
  if (!(pending instanceof Promise)) throw Error("Initialization must be asynchronous");
  const runtime = await pending;
  const capabilities = await runtime.negotiate();
  if (capabilities.kind !== "capabilities" || capabilities.implemented_operations.length) throw Error("Unexpected capabilities");
  try { await runtime.request({ op: "parse", format: "mathml", source: "<math><mi>α</mi></math>" }); }
  catch (error) {
    if (!(error instanceof LogifosError) || error.code !== "NOT_IMPLEMENTED") throw error;
    document.body.dataset.result = "passed";
  }
} catch (error) { document.body.textContent = String(error); }
</script>`;
  const dist = join(consumer, "node_modules/logifos-ts/dist");
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/") { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(page); return; }
      const route = new URL(request.url, "http://localhost").pathname;
      const [root, suffix] = route.startsWith("/dist/") ? [dist, route.slice(6)] :
        route.startsWith("/artifact/") ? [artifactDirectory, route.slice(10)] : [null, ""];
      if (!root) throw Error("Unknown route");
      const path = resolve(root, suffix);
      if (!path.startsWith(resolve(root) + sep)) throw Error("Invalid path");
      response.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "application/octet-stream");
      response.end(await readFile(path));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const { stdout } = await promisify(execFile)(process.env.CHROME_BIN || "google-chrome", [
      "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      `--user-data-dir=${join(scratch, "chrome-profile")}`, "--dump-dom", "--virtual-time-budget=5000",
      `http://127.0.0.1:${server.address().port}/`,
    ], { timeout: 30000, maxBuffer: 1024 * 1024 });
    assert.match(stdout, /<body data-result="passed">/, "Browser installed-package smoke failed");
    console.log("Browser installed-package transport smoke passed");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
