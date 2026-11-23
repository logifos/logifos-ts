export interface ContractIdentity {
  origin: string;
  revision: string;
  schema_path: string;
  sha256: string;
}

export type LimitName = "request_bytes" | "json_depth" | "source_bytes" |
  "tree_nodes" | "tree_depth" | "font_count" | "font_bytes" |
  "total_font_bytes" | "response_bytes" | "glyphs";

export interface FontResource {
  id: string;
  bytes: Uint8Array;
  /** Omit to compute the digest; supplied identities are checked by the core. */
  sha256?: string;
  face_index?: number;
}

export interface Options {
  limits?: Partial<Record<LimitName, number>>;
  font_size_px?: number;
  display?: "inline" | "block";
  color?: string;
  fonts?: readonly FontResource[];
  fallback_order?: readonly string[];
}

export type Operation =
  | { op: "negotiate" }
  | { op: "parse"; format: "mathml"; source: string }
  | { op: "transform"; format: "mathml";
      direction: "syntax_to_formula" | "formula_to_syntax";
      input: Record<string, unknown>; input_contract: ContractIdentity;
      output_contract: ContractIdentity }
  | { op: "render"; formula: Record<string, unknown>;
      formula_contract: ContractIdentity; output: "svg" | "png" };

export type Request = Operation & { options?: Options };

export interface Capabilities {
  kind: "capabilities";
  abi_versions: number[];
  schema_versions: number[];
  implemented_operations: ("parse" | "transform" | "render")[];
  outputs: "svg"[];
  formula_contract: ContractIdentity | null;
  syntax_contract: ContractIdentity | null;
  limits: Partial<Record<LimitName, number>>;
}

export interface SvgResult {
  kind: "svg";
  media_type: "image/svg+xml";
  encoding: "utf-8";
  svg: string;
  metrics: {
    unit: "css_px"; width: number; height: number; depth: number; baseline: number;
    ink_bounds: { x: number; y: number; width: number; height: number };
  };
  fonts_used: { id: string; sha256: string; face_index: number }[];
}

export type Result = Capabilities | SvgResult |
  { kind: "syntax"; format: "mathml"; syntax_contract: ContractIdentity;
    value: Record<string, unknown> } |
  { kind: "formula"; formula_contract: ContractIdentity;
    value: Record<string, unknown> };

export const errorCodes = [
  "INVALID_UTF8", "INVALID_JSON", "INVALID_REQUEST", "UNSUPPORTED_ABI",
  "UNSUPPORTED_SCHEMA", "UNKNOWN_OPTION", "RESOURCE_LIMIT", "INVALID_FONT",
  "FONT_HASH_MISMATCH", "MISSING_FONT", "MISSING_GLYPH", "UNPINNED_CONTRACT",
  "CONTRACT_MISMATCH", "INVALID_MODEL", "UNSUPPORTED_SYNTAX", "UNSUPPORTED_OUTPUT",
  "NOT_IMPLEMENTED", "ALLOCATION_FAILED", "INTERNAL_ERROR",
] as const;
export type ErrorCode = typeof errorCodes[number];
export const errorStages = [
  "decode", "contract", "parse", "transform", "font", "layout", "svg", "transport",
] as const;
export interface ErrorDetails {
  code: ErrorCode;
  message: string;
  path: string;
  stage: typeof errorStages[number];
}
