#!/bin/bash
# Build the static web bundle (out/) for the Android APK.
# API routes and the dynamic /play/[id] route are excluded for this build;
# the static bundle is fully client-side and works offline in the WebView.
set -e
cd "$(dirname "$0")/.."

mkdir -p .static-exclude
if [ -d src/app/api ]; then mv src/app/api .static-exclude/api; fi
if [ -d "src/app/play/[id]" ]; then mv "src/app/play/[id]" .static-exclude/play-id; fi

STATIC_EXPORT=1 npx next build

if [ -d .static-exclude/api ]; then mv .static-exclude/api src/app/api; fi
if [ -d ".static-exclude/play-id" ]; then mv ".static-exclude/play-id" "src/app/play/[id]"; fi
rm -rf .static-exclude

echo ""
echo "Static build written to out/ — run 'npx cap sync android' next."
