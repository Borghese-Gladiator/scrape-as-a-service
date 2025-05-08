#!/usr/bin/env bash

set -euo pipefail

# Define paths
PROTO_DIR="../proto"
PY_OUT_DIR_1="../app/server/proto_gen"
PY_OUT_DIR_2="../app/worker-py/proto_gen"
JS_OUT_DIR="../app/worker-js/proto_gen"
PROTO_FILE="scrape_task.proto"

# Create output directories if they don't exist
mkdir -p "$PY_OUT_DIR_1"
mkdir -p "$PY_OUT_DIR_2"
mkdir -p "$JS_OUT_DIR"

# -----------------------------
# Python Compilation
# -----------------------------
echo "Compiling Protobuf for Python..."

python3 -m grpc_tools.protoc \
  -I="$PROTO_DIR" \
  --python_out="$PY_OUT_DIR_1" \
  "$PROTO_DIR/$PROTO_FILE"

echo "✅ Python Protobuf compiled to $PY_OUT_DIR_1"

python3 -m grpc_tools.protoc \
  -I="$PROTO_DIR" \
  --python_out="$PY_OUT_DIR_2" \
  "$PROTO_DIR/$PROTO_FILE"

echo "✅ Python Protobuf compiled to $PY_OUT_DIR_2"

# -----------------------------
# JavaScript Compilation
# -----------------------------
# Check for local pbjs and pbts
PBJS="../app/worker-js/node_modules/.bin/pbjs"
PBTS="../app/worker-js/node_modules/.bin/pbts"

if [[ ! -x "$PBJS" || ! -x "$PBTS" ]]; then
  echo "⚠️  pbjs/pbts not found in ./node_modules/.bin"
  echo "➡️  Run: npm install --save-dev protobufjs"
  exit 1
fi

echo "Compiling Protobuf for JavaScript..."

$PBJS -t static-module -w commonjs -o "$JS_OUT_DIR/scrape_task.js" "$PROTO_DIR/$PROTO_FILE"
$PBTS -o "$JS_OUT_DIR/scrape_task.d.ts" "$JS_OUT_DIR/scrape_task.js"

echo "✅ JavaScript Protobuf compiled to $JS_OUT_DIR"

echo "🎉 All Protobufs compiled successfully!"
