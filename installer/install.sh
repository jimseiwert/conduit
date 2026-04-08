#!/usr/bin/env bash
# Conduit CLI installer — macOS and Linux
# Usage: curl -fsSL https://get.tunnel.digital/conduit | bash

set -euo pipefail

REPO="jimseiwert/conduit"
BINARY="conduit"
INSTALL_DIR="${CONDUIT_INSTALL_DIR:-/usr/local/bin}"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
  x86_64) ARCH="x64" ;;
  aarch64 | arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

case "$OS" in
  linux)  PLATFORM="linux-${ARCH}" ;;
  darwin) PLATFORM="macos-${ARCH}" ;;
  *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

# Get latest release tag
echo "Fetching latest release..."
TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"tag_name": "(.+)".*/\1/')
if [ -z "$TAG" ]; then
  echo "Failed to fetch latest release tag" >&2
  exit 1
fi

URL="https://github.com/${REPO}/releases/download/${TAG}/${BINARY}-${PLATFORM}"
echo "Downloading ${BINARY} ${TAG} for ${PLATFORM}..."
curl -fsSL -o "/tmp/${BINARY}" "$URL"
chmod +x "/tmp/${BINARY}"

# Verify binary runs
if ! "/tmp/${BINARY}" --version >/dev/null 2>&1; then
  echo "Downloaded binary failed to execute" >&2
  exit 1
fi

# Install
if [ -w "$INSTALL_DIR" ]; then
  mv "/tmp/${BINARY}" "${INSTALL_DIR}/${BINARY}"
else
  echo "Installing to $INSTALL_DIR (requires sudo)..."
  sudo mv "/tmp/${BINARY}" "${INSTALL_DIR}/${BINARY}"
fi

echo ""
echo "Conduit CLI installed successfully!"
echo "Run: conduit --help"
