#!/usr/bin/env bash
set -euo pipefail
# Keep compiler-generated paths independent of the build machine.
cargo_home=${CARGO_HOME:-$HOME/.cargo}
exec "$@" \
  --remap-path-prefix="$cargo_home=/cargo" \
  --remap-path-prefix="$(cd -- "$cargo_home" && pwd -P)=/cargo" \
  --remap-path-prefix="${WASM_CORE_DIR:?Set WASM_CORE_DIR to the core source directory}=/source"
