import { RuntimeError } from "./errors.js";
import { base64, decodeUtf8, initializationError, verifyArtifact } from "./integrity.js";
import { Runtime } from "./runtime.js";
import type { Transport } from "./runtime.js";
export * from "./public.js";

export interface InitializeOptions {
  /** Artifact root containing receipt.json and the web directory. */
  artifactUrl: string | URL;
  fetch?: typeof globalThis.fetch;
}

/** Fetch and verify executable bytes before importing or instantiating them. */
export async function initialize({ artifactUrl, fetch: fetchArtifact = globalThis.fetch }: InitializeOptions): Promise<Runtime> {
  try {
    const root = new URL(artifactUrl, globalThis.location?.href);
    if (!root.pathname.endsWith("/")) root.pathname += "/";
    if (!["https:", "http:"].includes(root.protocol)) {
      throw new RuntimeError("ARTIFACT_LOAD", "A WASM artifact HTTP(S) URL is required");
    }
    const artifact = await verifyArtifact(async path => {
      try {
        const response = await fetchArtifact(new URL(path, root));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      } catch (cause) {
        throw new RuntimeError("ARTIFACT_LOAD", `Cannot fetch WASM artifact: ${path}`, { cause });
      }
    }, "web");
    const instanceId = crypto.randomUUID();
    const moduleUrl = (bytes: Uint8Array): string =>
      `data:text/javascript;base64,${base64(bytes)}#${instanceId}`;
    const glueUrl = moduleUrl(artifact["logifos.js"]);
    const entry = decodeUtf8(artifact["index.js"]).replace("'./logifos.js'", JSON.stringify(glueUrl));
    const transport = await import(moduleUrl(new TextEncoder().encode(entry))) as Transport & {
      default(options: { module_or_path: Uint8Array }): Promise<unknown>;
    };
    // Unique module URLs keep bindgen state independent across initializations.
    await transport.default({ module_or_path: artifact["logifos_bg.wasm"] });
    return new Runtime(transport);
  } catch (cause) {
    throw initializationError(cause);
  }
}
