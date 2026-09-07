#!/bin/bash
# ==============================================================================
# SlimStream - One-Command Startup Script (macOS / Linux)
# ==============================================================================

echo "========================================================"
echo "          Starting SlimStream Video Dashboard           "
echo "========================================================"

# 1. Check for Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "[Error] Node.js is not installed. Please install Node.js (v18+) from https://nodejs.org/"
  exit 1
fi

# 2. Check for FFmpeg / FFprobe on host system and auto-install if package manager exists
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "FFmpeg is not installed on system PATH. Attempting automatic installation..."
  if command -v brew >/dev/null 2>&1; then
    echo "Installing FFmpeg via Homebrew..."
    brew install ffmpeg
  elif command -v apt-get >/dev/null 2>&1; then
    echo "Installing FFmpeg via APT..."
    sudo apt-get update && sudo apt-get install -y ffmpeg
  fi
fi

# 3. Install NPM dependencies if node_modules does not exist
if [ ! -d "node_modules" ]; then
  echo "Installing required project dependencies..."
  npm install
fi

echo "Starting SlimStream local server on http://localhost:3000..."
npm start

