#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$(dirname "$SDK_DIR")")"

# 可用环境变量覆盖，适配 backend 仓不在默认相对位置的布局
SWAGGER_PATH="${SWAGGER_PATH:-$ROOT_DIR/backend/service/gwsvr/internal/handler/swaggerui/swagger.json}"
OUTPUT_DIR="$SDK_DIR/src/openapi"

echo "[1/4] Installing dependencies..."
cd "$SDK_DIR"
npm install --prefer-offline 2>/dev/null || npm install

echo "[2/4] Generating client, api, react, vue modules (writes filtered swagger)..."
npx tsx "$SCRIPT_DIR/generate-openapi.ts" \
  --swagger "$SWAGGER_PATH" \
  --output "$OUTPUT_DIR"

echo "[3/4] Generating TypeScript types from filtered swagger..."
# 必须消费 tsx 步骤产出的 swagger.filtered.json（白名单端点+引用闭包 schema），
# 用原始 swagger 会把未纳入 SDK 的端点类型带进发布面
npx openapi-typescript "$SCRIPT_DIR/swagger.filtered.json" -o "$OUTPUT_DIR/types.ts"

echo "[4/4] Running TypeScript check..."
cd "$SDK_DIR"
npx tsc --noEmit

echo "Done! OpenAPI SDK generated at $OUTPUT_DIR"
