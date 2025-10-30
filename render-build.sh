#!/usr/bin/env bash
set -euo pipefail

echo "Installing Node dependencies..."
npm install

echo "Building TypeScript..."
npm run build

echo "Setting up Python environment..."
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo "Build steps complete."
