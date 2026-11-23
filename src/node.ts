import { lstat, readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileFunction } from "node:vm";
import { RuntimeError } from "./errors.js";
import { artifactFiles, decodeUtf8, initializationError, verifyArtifact } from "./integrity.js";
import { Runtime } from "./runtime.js";
import type { Transport } from "./runtime.js";
export * from "./public.js";

export interface InitializeOptions { artifactDirectory: string | URL }

/** Load an exact, caller-supplied artifact. No search paths or fallback engine. */
export async function initialize({ artifactDirectory }: InitializeOptions): Promise<Runtime> {
  try {
    const root = artifactDirectory instanceof URL ? fileURLToPath(artifactDirectory) : resolve(artifactDirectory);
    for (const [directory, expected] of [
      [root, ["nodejs", "web", "receipt.json"]],
      [join(root, "nodejs"), artifactFiles],
      [join(root, "web"), artifactFiles],
    ] as const) {
      const names = await readdir(directory);
      if (names.sort().join("\n") !== [...expected].sort().join("\n")) {
        throw new RuntimeError("RECEIPT_MISMATCH", "Unexpected or missing WASM artifact files");
      }
      for (const name of expected) {
        const info = await lstat(join(directory, name));
        if (info.isSymbolicLink() || !(name === "nodejs" || name === "web" ? info.isDirectory() : info.isFile())) {
          throw new RuntimeError("RECEIPT_MISMATCH", "WASM artifact entries must be regular files and directories");
        }
      }
    }
    const read = async (path: string): Promise<Uint8Array> => {
      try { return new Uint8Array(await readFile(join(root, path))); }
      catch (cause) { throw new RuntimeError("ARTIFACT_LOAD", `Cannot read WASM artifact: ${path}`, { cause }); }
    };
    // Both targets belong to the exact receipt, even when only Node is loaded.
    const node = await verifyArtifact(read, "nodejs");
    await verifyArtifact(read, "web");
    const evaluate = (source: Uint8Array, require: (name: string) => unknown): Record<string, unknown> => {
      const module = { exports: {} as Record<string, unknown> };
      compileFunction(decodeUtf8(source), ["exports", "require", "module", "__dirname"])(
        module.exports, require, module, ".",
      );
      return module.exports;
    };
    // Execute verified snapshots; generated glue cannot reopen mutable artifact files.
    const glue = evaluate(node["logifos.js"], name => {
      if (name !== "fs") throw new Error("Unexpected WASM glue dependency");
      return { readFileSync: (path: string) => {
        if (path !== "./logifos_bg.wasm") throw new Error("Unexpected WASM binary path");
        return node["logifos_bg.wasm"];
      } };
    });
    const transport = evaluate(node["index.js"], name => {
      if (name !== "./logifos.js") throw new Error("Unexpected WASM entry dependency");
      return glue;
    }) as unknown as Transport;
    return new Runtime(transport);
  } catch (cause) {
    throw initializationError(cause);
  }
}
