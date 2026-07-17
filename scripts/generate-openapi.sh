#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_DIR="$(dirname "$SCRIPT_DIR")"
# sdk is a submodule of the Tier0 meta repo (<root>/sdk); backend sits next to it.
ROOT_DIR="$(dirname "$SDK_DIR")"

# Override SWAGGER_PATH, or pass the path as the first argument, to generate from
# a backend worktree. --operation overlays selected operations onto the pinned
# SDK baseline so a focused client PR does not absorb unrelated Swagger drift.
if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
  RAW_SWAGGER_PATH="$1"
  shift
else
  RAW_SWAGGER_PATH="${SWAGGER_PATH:-$ROOT_DIR/backend/service/gwsvr/internal/handler/swaggerui/swagger.json}"
fi
OPERATION_IDS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --operation)
      [ $# -ge 2 ] || { echo "ERROR: --operation requires an operationId" >&2; exit 1; }
      OPERATION_IDS+=("$2")
      shift 2
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      exit 1
      ;;
  esac
done
OUTPUT_DIR="$SDK_DIR/src/openapi"
BASE_SWAGGER_PATH="${OPENAPI_BASE_SWAGGER_PATH:-$SCRIPT_DIR/openapi-base.swagger.json}"

normalize_input_path() {
  case "$1" in
    [A-Za-z]:[\\/]*)
      if command -v wslpath >/dev/null 2>&1; then
        wslpath -u "$1"
      elif command -v cygpath >/dev/null 2>&1; then
        cygpath -u "$1"
      else
        printf '%s\n' "$1"
      fi
      ;;
    *) printf '%s\n' "$1" ;;
  esac
}

SOURCE_SWAGGER_PATH="$(normalize_input_path "$RAW_SWAGGER_PATH")"

if [ ! -f "$SOURCE_SWAGGER_PATH" ]; then
  echo "ERROR: swagger.json not found: $SOURCE_SWAGGER_PATH" >&2
  echo "Set SWAGGER_PATH to the gwsvr swagger.json in the backend checkout." >&2
  exit 1
fi

node_path() {
  if command -v wslpath >/dev/null 2>&1 && command -v node.exe >/dev/null 2>&1; then
    wslpath -w "$1"
  else
    printf '%s\n' "$1"
  fi
}

echo "[1/4] Installing dependencies..."
cd "$SDK_DIR"
npm install --prefer-offline 2>/dev/null || npm install

GENERATION_SWAGGER_PATH="$SOURCE_SWAGGER_PATH"
if [ ${#OPERATION_IDS[@]} -gt 0 ]; then
  if [ ! -f "$BASE_SWAGGER_PATH" ]; then
    echo "ERROR: pinned OpenAPI baseline not found: $BASE_SWAGGER_PATH" >&2
    exit 1
  fi
  GENERATION_SWAGGER_PATH="$(mktemp "$SDK_DIR/.openapi-merged.XXXXXX.json")"
  trap 'rm -f "$GENERATION_SWAGGER_PATH"' EXIT
  MERGE_ARGS=()
  for operation_id in "${OPERATION_IDS[@]}"; do
    MERGE_ARGS+=(--operation "$operation_id")
  done
  echo "Merging selected operations onto the pinned SDK OpenAPI baseline..."
  npx tsx "$(node_path "$SCRIPT_DIR/merge-openapi-operation.ts")" \
    --base "$(node_path "$BASE_SWAGGER_PATH")" \
    --source "$(node_path "$SOURCE_SWAGGER_PATH")" \
    --output "$(node_path "$GENERATION_SWAGGER_PATH")" \
    "${MERGE_ARGS[@]}"
fi

NODE_SWAGGER_PATH="$(node_path "$GENERATION_SWAGGER_PATH")"
NODE_TYPES_PATH="$(node_path "$OUTPUT_DIR/types.ts")"
NODE_GENERATOR_PATH="$(node_path "$SCRIPT_DIR/generate-openapi.ts")"
NODE_OUTPUT_DIR="$(node_path "$OUTPUT_DIR")"

echo "[2/4] Generating TypeScript types from swagger.json..."
npx openapi-typescript "$NODE_SWAGGER_PATH" -o "$NODE_TYPES_PATH"

echo "[3/4] Generating client, api, react, vue modules..."
npx tsx "$NODE_GENERATOR_PATH" \
  --swagger "$NODE_SWAGGER_PATH" \
  --output "$NODE_OUTPUT_DIR"

echo "[4/4] Running TypeScript check..."
cd "$SDK_DIR"
npx tsc --noEmit

echo "Done! OpenAPI SDK generated at $OUTPUT_DIR"
