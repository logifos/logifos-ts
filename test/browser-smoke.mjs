import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve, sep } from "node:path";

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
finally { await fetch("/result", { method: "POST", body: document.documentElement.outerHTML }); }
</script>`;
  const dist = join(consumer, "node_modules/logifos-ts/dist");
  let complete;
  const completion = new Promise(resolve => { complete = resolve; });
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/result" && request.method === "POST") {
        let dom = "";
        request.setEncoding("utf8");
        for await (const chunk of request) dom += chunk;
        response.end();
        complete(dom);
        return;
      }
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
  let chrome;
  let closed;
  let timer;
  let stderr = "";
  try {
    // Virtual time can expire while asynchronous initialization is still pending.
    // Keep Chrome alive until the page reports completion, bounded by real time.
    chrome = spawn(process.env.CHROME_BIN || "google-chrome", [
      "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      `--user-data-dir=${join(scratch, "chrome-profile")}`,
      `http://127.0.0.1:${server.address().port}/`,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    chrome.stderr.setEncoding("utf8");
    chrome.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-65536); });
    closed = once(chrome, "close");
    const stdout = await Promise.race([
      completion,
      closed.then(([code, signal]) => { throw Error(`Chrome exited before browser completion (${code ?? signal}): ${stderr}`); }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(`Browser smoke timed out waiting for page completion: ${stderr}`)), 30000);
      }),
    ]);
    assert.match(stdout, /<body data-result="passed">/, "Browser installed-package smoke failed");
    console.log("Browser installed-package transport smoke passed");
  } finally {
    clearTimeout(timer);
    if (chrome) {
      const killTimer = setTimeout(() => chrome.kill("SIGKILL"), 5000);
      chrome.kill();
      await closed.catch(() => {});
      clearTimeout(killTimer);
    }
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
