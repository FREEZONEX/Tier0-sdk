#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "=== Step 1: Check npm login ==="
npm whoami > /dev/null 2>&1 || { echo "Error: not logged in to npm. Run: npm login"; exit 1; }
echo "Logged in as: $(npm whoami)"

echo ""
echo "=== Step 2: Run tests ==="
npm test

echo ""
echo "=== Step 3: Build ==="
npm run build

echo ""
echo "=== Step 4: Preview package ==="
npm pack --dry-run 2>&1 | tail -20

echo ""
echo "=== Step 5: Publish ==="
read -p "Confirm publish @tier0/sdk@$(node -p "require('./package.json').version")? [y/N] " confirm
if [[ "$confirm" == [yY] || "$confirm" == [yY][eE][sS] ]]; then
  npm publish --access public
  echo "Published successfully!"
else
  echo "Publish cancelled."
  exit 0
fi
