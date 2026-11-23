import { LogifosError, RuntimeError } from "./errors.js";
import { base64, decodeUtf8, sha256 } from "./integrity.js";
import { errorCodes, errorStages } from "./types.js";
import type { Capabilities, ContractIdentity, ErrorDetails, Options, Request, Result, SvgResult } from "./types.js";

export interface Transport {
  request_json(bytes: Uint8Array): Uint8Array;
  max_request_bytes(): number;
}

const encoder = new TextEncoder();
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One initialized instance. Ordinary core refusals do not invalidate it. */
export class Runtime {
  #trapped = false;
  constructor(private readonly transport: Transport) {}

  /** Raw wire access for callers that already own a versioned UTF-8 envelope. */
  requestBytes(bytes: Uint8Array): Result {
    if (!(bytes instanceof Uint8Array)) throw new TypeError("Expected Uint8Array");
    if (this.#trapped) {
      throw new RuntimeError("INSTANCE_TRAPPED", "Initialize a fresh WASM instance after a trap");
    }
    let reply: Uint8Array;
    try {
      reply = this.transport.request_json(bytes);
    } catch (cause) {
      this.#trapped = true;
      throw new RuntimeError("INSTANCE_TRAPPED", "WASM request trapped; initialize a fresh instance", { cause });
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(decodeUtf8(reply));
    } catch (cause) {
      throw new RuntimeError("INVALID_RESPONSE", "WASM returned invalid UTF-8 JSON", { cause });
    }
    if (!object(envelope) || envelope.abi_version !== 1 || envelope.schema_version !== 1) {
      throw new RuntimeError("INVALID_RESPONSE", "WASM returned an incompatible response envelope");
    }
    if (envelope.ok === false && object(envelope.error)) {
      const error = envelope.error;
      if (errorCodes.includes(error.code as ErrorDetails["code"]) &&
          errorStages.includes(error.stage as ErrorDetails["stage"]) &&
          typeof error.message === "string" && error.message.length > 0 &&
          typeof error.path === "string") {
        throw new LogifosError(error as unknown as ErrorDetails);
      }
    } else if (envelope.ok === true && object(envelope.result) &&
        ["capabilities", "svg", "syntax", "formula"].includes(String(envelope.result.kind))) {
      return envelope.result as unknown as Result;
    }
    throw new RuntimeError("INVALID_RESPONSE", "WASM returned an invalid result or refusal");
  }

  async request(request: Request): Promise<Result> {
    // Capture caller data before awaiting hashing; later caller edits cannot change this call.
    const { options, ...operation } = request;
    const fonts = options?.fonts?.map(font => ({ ...font, bytes: new Uint8Array(font.bytes) }));
    const wire = JSON.parse(JSON.stringify({ ...operation, options: options && { ...options, fonts: undefined } })) as Record<string, unknown>;
    if (fonts) {
      (wire.options as Record<string, unknown>).fonts = await Promise.all(fonts.map(async font => ({
        id: font.id,
        bytes_base64: base64(font.bytes),
        sha256: font.sha256 ?? await sha256(font.bytes),
        face_index: font.face_index ?? 0,
      })));
    }
    return this.requestBytes(encoder.encode(JSON.stringify({ ...wire, abi_version: 1, schema_version: 1 })));
  }

  async negotiate(options?: Options): Promise<Capabilities> {
    const result = await this.request({ op: "negotiate", options });
    if (result.kind !== "capabilities") {
      throw new RuntimeError("INVALID_RESPONSE", "Negotiation returned an unexpected result");
    }
    return result;
  }

  async render(formula: Record<string, unknown>, formulaContract: ContractIdentity,
    options?: Options, output: "svg" | "png" = "svg"): Promise<SvgResult> {
    const result = await this.request({ op: "render", formula, formula_contract: formulaContract, options, output });
    if (result.kind !== "svg") {
      throw new RuntimeError("INVALID_RESPONSE", "Rendering returned an unexpected result");
    }
    return result;
  }
}
