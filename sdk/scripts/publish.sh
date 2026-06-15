#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

CURRENT_VERSION=$(node -p "require('./package.json').version")

# 可选：直接传版本号  bash scripts/publish.sh 0.2.0
if [[ -n "$1" ]]; then
  NEW_VERSION="$1"
  echo "Bumping version: $CURRENT_VERSION → $NEW_VERSION"
  npm version "$NEW_VERSION" --no-git-tag-version
  CURRENT_VERSION="$NEW_VERSION"
fi

echo "========================================"
echo "  Publishing @tier0/sdk@$CURRENT_VERSION"
echo "========================================"

echo ""
echo "=== Step 1: Check npm login ==="
npm whoami > /dev/null 2>&1 || { echo "Error: not logged in. Run: npm login"; exit 1; }
echo "Logged in as: $(npm whoami)"

echo ""
echo "=== Step 2: Run tests ==="
npm test

echo ""
echo "=== Step 3: Build ==="
npm run build

echo ""
echo "=== Step 4: Preview package contents ==="
npm pack --dry-run 2>&1 | tail -20

echo ""
echo "=== Step 5: Publish ==="
read -p "Confirm publish @tier0/sdk@$CURRENT_VERSION to npm? [y/N] " confirm
if [[ "$confirm" == [yY] || "$confirm" == [yY][eE][sS] ]]; then
  npm publish --access public
  echo ""
  echo "✓ Published @tier0/sdk@$CURRENT_VERSION"
  echo "  https://www.npmjs.com/package/@tier0/sdk"
else
  echo "Publish cancelled."
  exit 0
fi
