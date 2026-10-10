#!/bin/sh
# Measures LarpPassport app source against the agreed limits (complexity 15,
# nesting 4, 400 code lines per file, no console, no unused vars) and lists
# copy-pasted blocks. Tools install into a scratch dir, never into the repo.
# Usage: sh measure.sh [repo-root] [scratch-dir]
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "${1:-.}" && git rev-parse --show-toplevel)
TOOLS=${2:-${TMPDIR:-/tmp}/larp-measure}
mkdir -p "$TOOLS"
if [ ! -e "$TOOLS/node_modules/.bin/eslint" ] || [ ! -e "$TOOLS/node_modules/.bin/jscpd" ]; then
  (cd "$TOOLS" && npm init -y >/dev/null && npm install --no-audit --no-fund eslint@9.39.1 globals@15.15.0 jscpd@4.0.5 >/dev/null)
fi
# The config imports "globals", which resolves next to the config file.
cp "$HERE/eslint.config.mjs" "$TOOLS/eslint.config.mjs"

cd "$REPO"
FILES=$(git ls-files -co --exclude-standard 'larp-dashboard/src/*.js' 'larp-dashboard/src/*.jsx' 'larp-dashboard/*.js' 'larp-passport/mobile/*.js' 'larp-passport/mobile/src/*.js')
"$TOOLS/node_modules/.bin/eslint" -c "$TOOLS/eslint.config.mjs" --no-warn-ignored -f json $FILES > "$TOOLS/eslint.json" || true
echo "== Limit violations"
node "$HERE/summarize.cjs" "$TOOLS/eslint.json" "$REPO"

# Each app is scanned on its own: they are separate npm packages, so
# lookalike code across them is expected and not a finding.
cpd() {
  name=$1; shift
  rm -rf "$TOOLS/cpd-$name"
  "$TOOLS/node_modules/.bin/jscpd" --silent --min-tokens 40 --min-lines 4 --reporters json --output "$TOOLS/cpd-$name" \
    --format "javascript,jsx" --ignore "**/node_modules/**,**/dist*/**,**/*.test.*,**/__tests__/**" "$@" >/dev/null 2>&1 || true
  echo "-- $name"
  node "$HERE/cpd-summary.cjs" "$TOOLS/cpd-$name/jscpd-report.json"
}
echo "== Copy-pasted blocks within each app (40+ tokens, tests excluded)"
cpd dashboard larp-dashboard/src
cpd mobile larp-passport/mobile/src larp-passport/mobile/App.js
