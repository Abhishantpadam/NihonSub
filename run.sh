#!/bin/bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "=========================================================="
echo "🎌 KoeSub - Japanese Video Subtitler & Synchronized Player"
echo "=========================================================="

if [ ! -d "node_modules" ]; then
    echo "📦 Installing npm dependencies..."
    npm install
fi

echo "🚀 Starting KoeSub server on http://localhost:3000..."
node server.js
