# logifos-ts

logifos-ts is the bootstrap TypeScript package for the logifos math formula
renderer. It builds and packs as a JavaScript ES module with TypeScript
declarations. It does not render formulas yet.

## Current API

The package exports `render` and `NotImplementedError`. The declared signature is
`render(formula: unknown, format: "svg" | "png" = "svg"): Uint8Array`.

Every call to `render` throws `NotImplementedError`, including calls with the
default format, `"svg"`, or `"png"`. The return type describes the intended byte
output; no bytes are returned today. The input is not validated or converted.
There is no engine integration, WASM binary, SVG output, or PNG output in this
package.

## Build and pack

The package declares Node.js 22 or newer. The commands below were checked with
Node.js 24.22.2 and npm 11.19.1. Run them from the repository checkout:

```sh
npm ci
npm run build
npm pack
```

The build emits `dist/index.js` and `dist/index.d.ts`. Packing runs the build
again through `prepack` and writes `logifos-ts-0.1.0.tgz`. The tarball contains
those two emitted files, `package.json`, `README.md`, and `LICENSE.txt`.

To check the emitted JavaScript exports directly after building:

```sh
node --input-type=module -e \
  'import { render, NotImplementedError } from "./dist/index.js"; console.log(typeof render, typeof NotImplementedError);'
```

This prints `function function`. Importing succeeds; calling `render` still
throws. The package checks below also import `logifos-ts` by name from an
installed tarball.

## Checks

```sh
npm run typecheck
npm test
npm run test:package
npm run test:package -- --browser
```

The type check writes no output files. The unit test compiles source and tests
into `.test-build/`, then runs the emitted JavaScript with Node's test runner.
It checks that `render` throws `NotImplementedError`.

The package check packs a tarball, checks its five files, and installs it into a
temporary consumer. It imports the installed package, checks both exports and
three refusal cases (default, SVG, and PNG), and checks accepted and rejected
TypeScript usage against the installed declarations.

The browser variant repeats the package check and serves the installed
JavaScript module to headless Chrome. It checks the exports and the same three
refusal cases in the browser. Chrome must be available as `google-chrome`, or
`CHROME_BIN` must point to its executable. These checks cover the bootstrap
module and declarations; they do not test rendering.

## Planned runtime

The planned rendering path passes formula models through a WASM build of the
logifos engine and returns rendered bytes. Node and web runtime boundaries,
including WASM loading and initialization, are future work. SVG and PNG remain
unimplemented despite appearing in the declared API.

There is currently one shared ES module entry. Separate Node and web entry
points and a working WASM runtime are not available. The browser import check
above verifies only the current bootstrap module.
