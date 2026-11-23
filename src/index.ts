// The logifos TS/WASM runtime boundary: formula models in (the plurimath
// common model), SVG bytes out, through the logifos engine compiled to
// WASM. The engine call lands with P5; the boundary refuses typed.
export function render(formula: unknown, format: "svg" | "png" = "svg"): Uint8Array {
  throw new NotImplementedError(
    `the logifos engine boundary lands in P5 (got ${format})`,
  );
}

export class NotImplementedError extends Error {}
