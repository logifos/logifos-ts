# logifos-ts

TypeScript/WASM runtime for the logifos math formula renderer. Lands with
plurimath#539's pure-TS surface.

Requires Node.js 22 or newer. Install and check the runtime with:

```sh
npm ci
npm run typecheck
npm run build
npm test
npm run test:package
```

`npm test` compiles source and tests into `.test-build/` and runs the emitted
JavaScript with Node's test runner. `npm run build` emits the package into `dist/`.
The package check packs and installs the tarball in a temporary consumer, then
checks its runtime exports and TypeScript declarations.

To also check the installed runtime in headless Chrome, run
`npm run test:package -- --browser`. Chrome must be available as `google-chrome`
or via `CHROME_BIN`. CI runs this browser check as part of package qualification.
