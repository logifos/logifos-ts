import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { cp, readFile, writeFile, unlink, symlink } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function runtimeCases(api, browserApi, artifactDirectory, scratch) {
  const { initialize, Runtime, RuntimeError, LogifosError } = api;
  let instance;
  await test("installed Node entry initializes asynchronously", async () => {
    const pending = initialize({ artifactDirectory });
    assert.ok(pending instanceof Promise);
    instance = await pending;
    assert.ok(instance instanceof Runtime);
  });
  // The loader has already authenticated these files before this comparison.
  const direct = createRequire(import.meta.url)(join(artifactDirectory, "nodejs/index.js"));
  const encoder = new TextEncoder();
  const envelope = operation => ({ ...operation, abi_version: 1, schema_version: 1 });
  const wire = value => encoder.encode(JSON.stringify(value));
  const core = bytes => JSON.parse(new TextDecoder().decode(direct.request_json(bytes)));
  const identity = { origin: "https://example.invalid/formula", revision: "0".repeat(40),
    schema_path: "formula.json", sha256: "0".repeat(64) };
  const font = { id: "Example", bytes: new Uint8Array([0, 128, 255, 1]) };
  const options = { fonts: [font], fallback_order: ["Example"], color: "#123456",
    font_size_px: 18, display: "block" };
  const compareRefusal = async (operation, expectedCode) => {
    const expected = core(wire(envelope(operation)));
    assert.equal(expected.ok, false);
    assert.equal(expected.error.code, expectedCode);
    await assert.rejects(instance.request(operation), error => {
      assert.ok(error instanceof LogifosError);
      for (const key of ["code", "message", "stage", "path"]) assert.equal(error[key], expected.error[key]);
      return true;
    });
  };
  await test("negotiation matches pinned transport and advertises no renderer", async () => {
    const result = await instance.negotiate();
    assert.deepEqual(result, core(wire(envelope({ op: "negotiate" }))).result);
    assert.deepEqual(result.implemented_operations, []);
    assert.deepEqual(result.outputs, []);
    assert.equal(result.formula_contract, null);
    assert.equal(result.limits.request_bytes, 262144);
  });
  await test("Unicode parse refusal preserves the core envelope", () => compareRefusal(
    { op: "parse", format: "mathml", source: "<math><mi>α𝑥</mi></math>" }, "NOT_IMPLEMENTED"));
  await test("render returns the typed missing-font refusal", async () => {
    await compareRefusal({ op: "render", formula: {}, formula_contract: identity, output: "svg" }, "MISSING_FONT");
    await assert.rejects(instance.render({}, identity), error => error instanceof LogifosError && error.code === "MISSING_FONT");
  });
  await test("font bytes and complete options reach the core", async () => {
    const caps = await instance.negotiate(options);
    assert.equal(caps.kind, "capabilities");
    await assert.rejects(instance.render({}, identity, options), error =>
      error instanceof LogifosError && error.code === "UNPINNED_CONTRACT" && error.path === "/formula");
  });
  await test("supplied font identity is checked by the core", async () => {
    await assert.rejects(instance.negotiate({ fonts: [{ ...font, sha256: "0".repeat(64) }] }),
      error => error instanceof LogifosError && error.code === "FONT_HASH_MISMATCH" && error.path === "/options/fonts/0/sha256");
  });
  await test("font face indices and fallback order are transported", async () => {
    await assert.rejects(instance.negotiate({ fonts: [{ ...font, face_index: 65536 }] }),
      error => error instanceof LogifosError && error.code === "INVALID_REQUEST");
    await assert.rejects(instance.negotiate({ ...options, fallback_order: ["Missing"] }),
      error => error instanceof LogifosError && error.code === "INVALID_FONT");
  });
  await test("PNG refusal matches the core", () => compareRefusal(
    { op: "render", formula: {}, formula_contract: identity, output: "png" }, "UNSUPPORTED_OUTPUT"));
  await test("transform refusal matches the core", () => compareRefusal(
    { op: "transform", format: "mathml", direction: "syntax_to_formula", input: {},
      input_contract: identity, output_contract: identity }, "UNPINNED_CONTRACT"));
  await test("lowered source limit refuses and the instance remains reusable", async () => {
    await compareRefusal({ op: "parse", format: "mathml", source: "αβ",
      options: { limits: { source_bytes: 3 } } }, "RESOURCE_LIMIT");
    assert.equal((await instance.negotiate()).kind, "capabilities");
  });
  await test("font resource refusal does not retain request options or bytes", async () => {
    await assert.rejects(instance.negotiate({ ...options, limits: { font_bytes: 3 } }),
      error => error instanceof LogifosError && error.code === "RESOURCE_LIMIT");
    assert.equal((await instance.negotiate(options)).kind, "capabilities");
    assert.equal((await instance.negotiate()).limits.font_bytes, 131072);
  });
  await test("oversized raw request refuses before copying and remains reusable", async () => {
    assert.throws(() => instance.requestBytes(new Uint8Array(262145)),
      error => error instanceof LogifosError && error.code === "RESOURCE_LIMIT");
    assert.equal((await instance.negotiate()).kind, "capabilities");
  });
  for (const [name, bytes, code] of [
    ["UTF-8", new Uint8Array([255]), "INVALID_UTF8"],
    ["JSON", encoder.encode("{"), "INVALID_JSON"],
    ["ABI", wire({ ...envelope({ op: "negotiate" }), abi_version: 2 }), "UNSUPPORTED_ABI"],
    ["schema", wire({ ...envelope({ op: "negotiate" }), schema_version: 2 }), "UNSUPPORTED_SCHEMA"],
    ["option", wire(envelope({ op: "negotiate", options: { unknown: true } })), "UNKNOWN_OPTION"],
  ]) {
    await test(`raw ${name} refusal matches the core`, () => {
      const expected = core(bytes);
      assert.equal(expected.error.code, code);
      assert.throws(() => instance.requestBytes(bytes), error => {
        assert.ok(error instanceof LogifosError);
        for (const key of ["code", "message", "path", "stage"]) assert.equal(error[key], expected.error[key]);
        return true;
      });
    });
  }
  await test("independent Node initializations do not share options", async () => {
    const other = await initialize({ artifactDirectory: pathToFileURL(artifactDirectory) });
    const [lowered, normal] = await Promise.all([
      other.negotiate({ limits: { source_bytes: 10 } }), instance.negotiate(),
    ]);
    assert.equal(lowered.limits.source_bytes, 10);
    assert.equal(normal.limits.source_bytes, 65536);
  });
  await test("web entry initializes verified modules from fetched bytes in Node", async () => {
    const fetchArtifact = async url => new Response(await readFile(join(artifactDirectory, new URL(url).pathname.slice(1))));
    const web = await browserApi.initialize({ artifactUrl: "https://example.invalid/", fetch: fetchArtifact });
    assert.deepEqual(await web.negotiate(), await instance.negotiate());
    await assert.rejects(web.render({}, identity), error => error instanceof LogifosError && error.code === "MISSING_FONT");
    assert.throws(() => web.requestBytes(new Uint8Array(262145)), error => error instanceof LogifosError && error.code === "RESOURCE_LIMIT");
    assert.equal((await web.negotiate()).kind, "capabilities");
    const other = await browserApi.initialize({ artifactUrl: "https://example.invalid/", fetch: fetchArtifact });
    // Different module instances give different exported WASM request functions.
    assert.notEqual(web, other);
    assert.deepEqual(await other.negotiate(), await web.negotiate());
  });
  const mutations = [
    ["receipt", async root => writeFile(join(root, "receipt.json"), "{}")],
    ["glue", async root => writeFile(join(root, "nodejs/logifos.js"), "throw Error('unchecked glue')")],
    ["WASM", async root => writeFile(join(root, "nodejs/logifos_bg.wasm"), new Uint8Array([0]))],
    ["web glue", async root => writeFile(join(root, "web/logifos.js"), "throw Error('unchecked glue')")],
    ["missing file", async root => unlink(join(root, "nodejs/index.d.ts"))],
    ["extra file", async root => writeFile(join(root, "web/extra.js"), "")],
    ["symlink", async root => { await unlink(join(root, "nodejs/logifos_bg.wasm"));
      await symlink(join(artifactDirectory, "nodejs/logifos_bg.wasm"), join(root, "nodejs/logifos_bg.wasm")); }],
  ];
  for (const [name, mutate] of mutations) {
    await test(`installed loader rejects ${name} mismatch`, async () => {
      const root = join(scratch, `altered-${name.replaceAll(" ", "-")}`);
      await cp(artifactDirectory, root, { recursive: true });
      await mutate(root);
      await assert.rejects(initialize({ artifactDirectory: root }),
        error => error instanceof RuntimeError && error.code === "RECEIPT_MISMATCH");
    });
  }
  await test("browser rejects altered glue and WASM before execution", async () => {
    for (const altered of ["web/logifos.js", "web/logifos_bg.wasm"]) {
      await assert.rejects(browserApi.initialize({ artifactUrl: "https://example.invalid/",
        fetch: async url => {
          const path = new URL(url).pathname.slice(1);
          return new Response(path === altered ? new Uint8Array([0]) : await readFile(join(artifactDirectory, path)));
        } }), error => error instanceof RuntimeError && error.code === "RECEIPT_MISMATCH");
    }
  });
}
