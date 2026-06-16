#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$(dirname "$SDK_DIR")")"

SWAGGER_PATH="$ROOT_DIR/backend/service/gwsvr/internal/handler/swaggerui/swagger.json"
OUTPUT_DIR="$SDK_DIR/src/openapi"

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
