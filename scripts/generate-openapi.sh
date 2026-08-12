#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_DIR="$(dirname "$SCRIPT_DIR")"
# sdk is a submodule of the Tier0 meta repo (<root>/sdk); backend sits next to it.
ROOT_DIR="$(dirname "$SDK_DIR")"

# swagger.json is committed in Tier0-Backend (gwsvr swaggerui handler serves it).
# Override SWAGGER_PATH to point at another checkout (e.g. a backend worktree).
SWAGGER_PATH="${SWAGGER_PATH:-$ROOT_DIR/backend/service/gwsvr/internal/handler/swaggerui/swagger.json}"
OUTPUT_DIR="$SDK_DIR/src/openapi"

if [ ! -f "$SWAGGER_PATH" ]; then
  echo "ERROR: swagger.json not found: $SWAGGER_PATH" >&2
  echo "Troubleshooting:" >&2
  echo "  1. Run this script from the Tier0 meta repo where sdk/ and backend/ are siblings." >&2
  echo "  2. The swaggerui spec currently lives on the backend dev branch; make sure the" >&2
  echo "     backend checkout includes service/gwsvr/internal/handler/swaggerui/swagger.json." >&2
  echo "  3. Or pass an explicit path: SWAGGER_PATH=/path/to/swagger.json bash scripts/generate-openapi.sh" >&2
  exit 1
fi

echo "[1/4] Installing dependencies..."
cd "$SDK_DIR"
npm install --prefer-offline 2>/dev/null || npm install

echo "[2/4] Generating TypeScript types from swagger.json..."
npx openapi-typescript "$SWAGGER_PATH" -o "$OUTPUT_DIR/types.ts"

echo "[3/4] Generating client, api, react, vue modules..."
npx tsx "$SCRIPT_DIR/generate-openapi.ts" \
  --swagger "$SWAGGER_PATH" \
  --output "$OUTPUT_DIR"

echo "[4/4] Running TypeScript check..."
cd "$SDK_DIR"
npx tsc --noEmit

echo "Done! OpenAPI SDK generated at $OUTPUT_DIR"
