#!/bin/bash
# Setup script for deploying host-service on a remote VPS
# Usage: ssh user@host 'bash -s' < scripts/setup-remote-host.sh

set -e

echo "=== Superset Host Service Setup ==="

# Install bun if not present
if ! command -v bun &> /dev/null; then
    echo "[1/5] Installing bun..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
else
    echo "[1/5] Bun already installed: $(bun --version)"
fi

# Install git if not present
if ! command -v git &> /dev/null; then
    echo "[2/5] Installing git..."
    apt-get update -qq && apt-get install -y -qq git
else
    echo "[2/5] Git already installed"
fi

# Clone repo if not present
REPO_DIR="$HOME/superset-ss"
if [ ! -d "$REPO_DIR" ]; then
    echo "[3/5] Cloning superset-ss..."
    git clone https://github.com/m0d02x/superset-ss "$REPO_DIR"
else
    echo "[3/5] Repo already exists, pulling latest..."
    cd "$REPO_DIR" && git pull
fi

# Install dependencies
echo "[4/5] Installing dependencies..."
cd "$REPO_DIR"
bun install

# Generate a PSK secret
SECRET=$(openssl rand -hex 32)
echo "[5/5] Starting host-service..."
echo ""
echo "========================================"
echo "  PSK Secret: $SECRET"
echo "  Port: 4879"
echo "========================================"
echo ""
echo "Copy the PSK secret above into the Superset desktop app."
echo ""

# Start host-service
cd "$REPO_DIR/packages/host-service"
HOST_SERVICE_SECRET="$SECRET" PORT=4879 bun run src/serve.ts
