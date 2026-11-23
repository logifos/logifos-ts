import type { ErrorDetails } from "./types.js";

/** A refusal returned by the shared core, with its original wire details. */
export class LogifosError extends Error {
  readonly name = "LogifosError";
  readonly abi_version = 1;
  readonly schema_version = 1;
  readonly code: ErrorDetails["code"];
  readonly path: string;
  readonly stage: ErrorDetails["stage"];

  constructor(details: ErrorDetails) {
    super(details.message);
    this.code = details.code;
    this.path = details.path;
    this.stage = details.stage;
  }
}

export type RuntimeErrorCode = "ARTIFACT_LOAD" | "RECEIPT_MISMATCH" |
  "INITIALIZATION_FAILED" | "INVALID_RESPONSE" | "INSTANCE_TRAPPED";

/** A loader/protocol failure, distinct from a core refusal. */
export class RuntimeError extends Error {
  readonly name = "RuntimeError";
  constructor(readonly code: RuntimeErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
