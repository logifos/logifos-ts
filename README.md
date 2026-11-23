# logifos-ts

logifos-ts is a bootstrap package for a math formula rendering API. It exports
`render` and `NotImplementedError` as JavaScript ES modules with TypeScript
declarations. There is no WASM renderer yet: every call to `render` throws
`NotImplementedError`, and no SVG or PNG output is produced.

The declared API is `render(formula, format)`, where `formula` has type `unknown`
and `format` is either `"svg"` or `"png"`, defaulting to `"svg"`. Its declared
return type is `Uint8Array`, but rendering is not implemented.

Use Node.js 22 or newer. From a checkout of this repository, install the
development dependencies and build the package with:

```sh
npm ci
npm run build
```

The build writes JavaScript and TypeScript declarations to `dist/`. The package
entry point is `dist/index.js`, with declarations in `dist/index.d.ts`.

Run the checks from the same checkout:

```sh
npm run typecheck
npm test
npm run test:package
```

The type check compiles without writing output. The test command compiles source
and tests into `.test-build/`, then runs the emitted JavaScript with Node's test
runner to check that rendering throws `NotImplementedError`. The package check
builds and packs a tarball, installs it in a temporary consumer, checks the
exported API and refusal behavior, and checks valid and invalid TypeScript usage
against the installed declarations.

To check the installed module in headless Chrome as well, run:

```sh
npm run test:package -- --browser
```

This requires Chrome available as `google-chrome`, or its executable path set in
`CHROME_BIN`. The browser check verifies module imports and the same refusal
behavior. These checks verify the bootstrap package; they do not render formulas.
