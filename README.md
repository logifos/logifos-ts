# logifos-ts

TypeScript transport for the shared Logifos Rust core, compiled to WASM. This
ES module package supports Node.js 22+ and a separate browser entry. It does not
contain a layout engine, bundled fonts, generated WASM, or a rendering fallback.
Only version negotiation currently succeeds. Rendering returns a typed core
refusal; no SVG, metrics, or PNG output is available yet.

## Node

Supply the root of an externally built WASM transport artifact:

```ts
import { initialize, LogifosError } from "logifos-ts";

const runtime = await initialize({ artifactDirectory: "./wasm-transport" });
const capabilities = await runtime.negotiate();
console.log(capabilities.implemented_operations); // []

try {
  await runtime.request({
    op: "parse", format: "mathml", source: "<math><mi>α</mi></math>",
  });
} catch (error) {
  if (error instanceof LogifosError) console.log(error.code); // NOT_IMPLEMENTED
  else throw error;
}
```

`logifos-ts/node` explicitly selects the same Node loader. Initialization always
returns a promise and creates a new instance. Artifact locations are explicit;
there is no directory search, download, or alternate engine.

## Browser

```ts
import { initialize } from "logifos-ts/browser";

const runtime = await initialize({
  artifactUrl: new URL("/wasm-transport/", location.href),
});
const capabilities = await runtime.negotiate();
```

The root export also selects the browser entry when the resolver supports the
`browser` condition. Browser modules have no filesystem or Node imports. Serve
the artifact's `receipt.json` and complete `web/` directory over HTTP(S), with
CORS permissions when needed. Initialization accepts an optional `fetch`
function. It verifies fetched bytes, imports the verified JavaScript through
`data:` module URLs, and passes verified WASM bytes to bindgen's asynchronous
initializer. A content security policy must permit those module URLs and WASM
compilation. Web Crypto requires a secure context, such as HTTPS or localhost.
Each initialization has independent bindgen/WASM state.

## Requests and refusals

`runtime.request(request)` returns a promise for the core result. The wrapper
supplies ABI and schema version 1 and passes explicit operations and options
through the facade JSON boundary. `runtime.negotiate(options?)` returns typed
capabilities. The core currently advertises empty implemented-operation and
output lists, unresolved model identities, and its transport limits.

`runtime.render(formula, formulaContract, options?, output = "svg")` also returns
a promise. It requires the caller's contract identity and currently rejects:
SVG without fonts produces `MISSING_FONT`; SVG with valid font-byte identities
produces `UNPINNED_CONTRACT`; PNG produces `UNSUPPORTED_OUTPUT`. Contract
identities cannot enable rendering while the core's model pins remain unresolved.
The old synchronous `render` stub and `NotImplementedError` export were removed.

Options support `font_size_px`, `display`, `color`, `fallback_order`, resource
`limits`, and caller-supplied fonts:

```ts
const options = {
  fonts: [{ id: "Example", bytes: new Uint8Array([0, 128, 255]), face_index: 0 }],
  fallback_order: ["Example"],
  limits: { source_bytes: 1024 },
} as const;
await runtime.negotiate(options);
```

These example bytes only demonstrate transport, not a usable font. The wrapper
snapshots request data, base64-encodes exactly the supplied byte view, and computes
SHA-256 when omitted. A supplied `sha256` is passed through for core validation.
Font bytes, options, and lowered limits apply to one request only. The wrapper
does not interpret fonts, validate Formula, perform layout, or encode images.

`LogifosError` preserves the core's `code`, `message`, `path`, `stage`,
`abi_version`, and `schema_version`. Malformed requests, unknown options, and
resource limits remain core decisions. Ordinary refusals allow immediate reuse.
`RuntimeError` identifies artifact, initialization, protocol, and trap failures
with its own `code`. A trapped instance refuses further calls; initialize a
fresh one. No recovery after allocation exhaustion is promised.

`runtime.requestBytes(bytes)` is synchronous raw access for a complete versioned
UTF-8 JSON request. It returns a decoded result or throws the same typed errors.
Use the generated artifact's checked entry, never its raw bindgen function. Its
request ceiling prevents copying oversized caller buffers into WASM before the
core returns `RESOURCE_LIMIT`.

## Artifact integrity and packaging

The package exports `receiptSha256`, an exact SHA-256 trust anchor for the
supported transport receipt. The receipt binds source inputs, Cargo.lock,
Rust 1.95.0, wasm-bindgen 0.2.105, wire-contract schemas, and generated artifact
files. Initialization rejects a different receipt before executing glue, then
checks each selected target file against the trusted receipt. Node additionally
checks the complete two-target file inventory and hashes both targets, rejecting
missing, extra, or symlinked artifact entries. The browser checks all nine web
files; HTTP does not expose a directory inventory. Hashes are integrity pins,
not supplier signatures.

The expected artifact layout is `receipt.json`, `nodejs/`, and `web/`; each target
contains `index.js`, `index.d.ts`, `logifos.js`, `logifos.d.ts`,
`logifos_bg.wasm`, `logifos_bg.wasm.d.ts`, `package.json`, `LICENSE.txt`, and
`THIRD-PARTY-LICENSES.txt`. Keep the generated notices with the artifact.
Node executes verified in-memory snapshots so glue cannot reopen changed files.
The browser imports snapshots and supplies the matching bytes directly.

Artifacts stay external: this repository's package ships compiled wrapper
JavaScript/declarations and its license/README only. No generated WASM or glue
is committed or packed, and no publication command is added. An artifact update
requires rebuilding from the intended inputs, checking the supplier receipt,
updating `src/pin.ts`, and rerunning installed-package checks.

## Local checks

```sh
npm ci
npm run build
npm run typecheck
npm test
LOGIFOS_WASM_ARTIFACT=./wasm-transport npm run test:package
```

The focused unit checks cover refusal mapping, invalid responses, traps,
snapshotting, and loader failures. The installed-package check packs and installs
a temporary tarball offline, exercises actual Node and web WASM transport in
Node, compares refusals to the pinned core, tests resource-refusal reuse and
artifact tampering, checks installed declarations for both resolution conditions,
and traverses browser imports for Node dependencies. The repository has no lint
script. `npm run test:package -- --browser` additionally requires an existing
Chrome executable (`CHROME_BIN` may override it) and runs a browser transport
smoke. Running web modules in Node does not qualify browsers or rendering.
