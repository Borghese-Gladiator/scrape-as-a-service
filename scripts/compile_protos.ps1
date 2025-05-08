# Exit on errors
$ErrorActionPreference = "Stop"

# Define paths
$PROTO_DIR = "../proto"
$PY_OUT_DIR_1 = "../app/server/proto_gen"
$PY_OUT_DIR_2 = "../app/worker-py/proto_gen"
$JS_OUT_DIR = "../app/worker-js/proto_gen"
$PROTO_FILE = "scrape_task.proto"

# Create output directories if they don't exist
New-Item -ItemType Directory -Force -Path $PY_OUT_DIR_1 | Out-Null
New-Item -ItemType Directory -Force -Path $PY_OUT_DIR_2 | Out-Null
New-Item -ItemType Directory -Force -Path $JS_OUT_DIR | Out-Null

# -----------------------------
# Python Compilation
# -----------------------------
Write-Output "Compiling Protobuf for Python..."

# Run from app/server
Push-Location "../app/server"
poetry run python -m grpc_tools.protoc -I="$($PWD)/../../proto" --python_out="$($PWD)/proto_gen" $PROTO_FILE
Pop-Location
Write-Host "✅ Python Protobuf compiled to $PY_OUT_DIR_1"

Push-Location "../app/worker-py"
$protoDir = Resolve-Path "../../proto"
$pyOutDir = Join-Path $PWD "proto_gen"
poetry run python -m grpc_tools.protoc -I="$($PWD)/../../proto" --python_out="$($PWD)/proto_gen" $PROTO_FILE
Pop-Location
Write-Host "✅ Python Protobuf compiled to $PY_OUT_DIR_2"

# -----------------------------
# JavaScript Compilation
# -----------------------------
$PBJS = "../app/worker-js/node_modules/.bin/pbjs.cmd"
$PBTS = "../app/worker-js/node_modules/.bin/pbts.cmd"

if (-Not (Test-Path $PBJS) -or -Not (Test-Path $PBTS)) {
  Write-Warning "⚠️  pbjs/pbts not found in ./node_modules/.bin"
  Write-Output "➡️  Run: npm install --save-dev protobufjs"
  exit 1
}

Write-Output "Compiling Protobuf for JavaScript..."

& $PBJS -t static-module -w commonjs -o "$JS_OUT_DIR/scrape_task.js" "$PROTO_DIR/$PROTO_FILE"
& $PBTS -o "$JS_OUT_DIR/scrape_task.d.ts" "$JS_OUT_DIR/scrape_task.js"

Write-Output "✅ JavaScript Protobuf compiled to $JS_OUT_DIR"

Write-Output "🎉 All Protobufs compiled successfully!"
