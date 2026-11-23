import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";

export async function checkBrowser(consumer, scratch) {
  const runtime = await readFile(join(consumer, "node_modules/logifos-ts/dist/index.js"));
  const page = `<!doctype html><body><script type="module">
import { render, NotImplementedError } from "/runtime.js";
try {
  if (typeof render !== "function" || typeof NotImplementedError !== "function") {
    throw new Error("Missing runtime exports");
  }
  for (const args of [[{}], [{}, "svg"], [{}, "png"]]) {
    let refused = false;
    try { render(...args); } catch (error) {
      refused = error instanceof NotImplementedError && error instanceof Error &&
        error.message.includes("the logifos engine boundary lands in P5");
    }
    if (!refused) throw new Error("Expected typed refusal");
  }
  document.body.dataset.result = "passed";
} catch (error) {
  document.body.textContent = String(error);
}
</script>`;
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/runtime.js"
      ? "text/javascript" : "text/html");
    response.end(request.url === "/runtime.js" ? runtime : page);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const { stdout } = await promisify(execFile)(process.env.CHROME_BIN || "google-chrome", [
      "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      `--user-data-dir=${join(scratch, "chrome-profile")}`,
      "--dump-dom", "--virtual-time-budget=5000",
      `http://127.0.0.1:${server.address().port}/`,
    ], { timeout: 30000, maxBuffer: 1024 * 1024 });
    assert.match(stdout, /<body data-result="passed">/, "Browser packed-package assertions failed");
    console.log("Browser installed package: 3 typed refusal cases passed");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
