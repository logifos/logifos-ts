import { RuntimeError } from "./errors.js";
import { receiptSha256 } from "./pin.js";

export const artifactFiles = [
  "LICENSE.txt", "THIRD-PARTY-LICENSES.txt", "index.d.ts", "index.js",
  "logifos.d.ts", "logifos.js", "logifos_bg.wasm", "logifos_bg.wasm.d.ts",
  "package.json",
] as const;
export type ArtifactTarget = "nodejs" | "web";
export type ReadArtifact = (path: string) => Promise<Uint8Array>;
export type Artifact = Record<typeof artifactFiles[number], Uint8Array>;
export const decodeUtf8 = (bytes: Uint8Array): string =>
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Check the receipt trust anchor before using any filenames or executable bytes. */
export async function verifyArtifact(read: ReadArtifact, target: ArtifactTarget): Promise<Artifact> {
  const receiptBytes = await read("receipt.json");
  if (await sha256(receiptBytes) !== receiptSha256) {
    throw new RuntimeError("RECEIPT_MISMATCH", "The WASM receipt does not match this runtime");
  }
  const receipt = JSON.parse(decodeUtf8(receiptBytes)) as {
    artifacts_sha256: Record<string, string>;
  };
  const entries = await Promise.all(artifactFiles.map(async name => {
    const bytes = await read(`${target}/${name}`);
    if (await sha256(bytes) !== receipt.artifacts_sha256[`${target}/${name}`]) {
      throw new RuntimeError("RECEIPT_MISMATCH", `WASM artifact digest mismatch: ${target}/${name}`);
    }
    return [name, bytes] as const;
  }));
  return Object.fromEntries(entries) as Artifact;
}

export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

export function initializationError(cause: unknown): RuntimeError {
  return cause instanceof RuntimeError ? cause :
    new RuntimeError("INITIALIZATION_FAILED", "WASM initialization failed", { cause });
}
