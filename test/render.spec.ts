import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Runtime, RuntimeError, LogifosError } from "../src/public.js";
import { verifyArtifact, sha256 } from "../src/integrity.js";
import { initialize as initializeBrowser } from "../src/browser.js";

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const refusal = { abi_version: 1, schema_version: 1, ok: false,
  error: { code: "MISSING_FONT", message: "Caller fonts required", path: "/options/fonts", stage: "contract" } };

function runtime(reply: unknown): Runtime {
  return new Runtime({ request_json: () => encode(reply), max_request_bytes: () => 262144 });
}

describe("response handling", () => {
  it("preserves structured core refusals", () => {
    assert.throws(() => runtime(refusal).requestBytes(new Uint8Array()), error =>
      error instanceof LogifosError && error.code === "MISSING_FONT" &&
      error.path === "/options/fonts" && error.stage === "contract" &&
      error.message === refusal.error.message && error.abi_version === 1 && error.schema_version === 1);
  });
  for (const [label, reply] of Object.entries({
    null: null, version: { ...refusal, abi_version: 2 },
    code: { ...refusal, error: { ...refusal.error, code: "invented" } },
    stage: { ...refusal, error: { ...refusal.error, stage: "invented" } },
    path: { ...refusal, error: { ...refusal.error, path: null } },
    result: { abi_version: 1, schema_version: 1, ok: true, result: {} },
  })) {
    it(`rejects malformed ${label} responses`, () => {
      assert.throws(() => runtime(reply).requestBytes(new Uint8Array()),
        error => error instanceof RuntimeError && error.code === "INVALID_RESPONSE");
    });
  }
  it("rejects invalid response UTF-8", () => {
    const instance = new Runtime({ request_json: () => new Uint8Array([255]), max_request_bytes: () => 1 });
    assert.throws(() => instance.requestBytes(new Uint8Array()),
      error => error instanceof RuntimeError && error.code === "INVALID_RESPONSE");
  });
  it("stops using an instance after a trap", () => {
    let calls = 0;
    const instance = new Runtime({ request_json: () => { calls++; throw new WebAssembly.RuntimeError("unreachable"); },
      max_request_bytes: () => 1 });
    for (let i = 0; i < 2; i++) {
      assert.throws(() => instance.requestBytes(new Uint8Array()),
        error => error instanceof RuntimeError && error.code === "INSTANCE_TRAPPED");
    }
    assert.equal(calls, 1);
  });
  it("rejects incompatible results for negotiation and render", async () => {
    const instance = runtime({ abi_version: 1, schema_version: 1, ok: true,
      result: { kind: "formula", value: {} } });
    await assert.rejects(instance.negotiate(), RuntimeError);
    await assert.rejects(instance.render({}, { origin: "test", revision: "0".repeat(40),
      schema_path: "formula.json", sha256: "0".repeat(64) }), RuntimeError);
  });
  it("snapshots font subarrays, formulas and options before hashing", async () => {
    let actual: unknown;
    const instance = new Runtime({ request_json: bytes => {
      actual = JSON.parse(new TextDecoder().decode(bytes)); return encode(refusal);
    }, max_request_bytes: () => 262144 });
    const bytes = new Uint8Array([90, 0, 128, 255, 91]);
    const options = { fonts: [{ id: "Example", bytes: bytes.subarray(1, 4) }], color: "#123456" };
    const promise = instance.request({ op: "negotiate", options });
    bytes.fill(42); options.color = "#ffffff"; options.fonts[0].id = "Changed";
    await assert.rejects(promise, LogifosError);
    assert.deepEqual(actual, { op: "negotiate", abi_version: 1, schema_version: 1,
      options: { color: "#123456", fonts: [{ id: "Example", bytes_base64: "AID/",
        sha256: await sha256(new Uint8Array([0, 128, 255])), face_index: 0 }] } });
  });
});

describe("artifact failures", () => {
  it("rejects an untrusted receipt before reading executable files", async () => {
    const reads: string[] = [];
    await assert.rejects(verifyArtifact(async path => { reads.push(path); return encode({}); }, "web"),
      error => error instanceof RuntimeError && error.code === "RECEIPT_MISMATCH");
    assert.deepEqual(reads, ["receipt.json"]);
  });
  it("maps browser HTTP failures", async () => {
    await assert.rejects(initializeBrowser({ artifactUrl: "https://example.invalid/wasm/",
      fetch: async () => new Response("missing", { status: 404 }) }),
    error => error instanceof RuntimeError && error.code === "ARTIFACT_LOAD");
  });
  it("rejects non-HTTP browser artifact URLs", async () => {
    await assert.rejects(initializeBrowser({ artifactUrl: "file:///wasm/" }),
      error => error instanceof RuntimeError && error.code === "ARTIFACT_LOAD");
  });
});
