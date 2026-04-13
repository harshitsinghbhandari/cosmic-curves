#!/bin/bash

# CosmosCurves - Unified App Launcher
# Starts both backend and frontend concurrently

set -e

echo "🌌 Starting CosmosCurves..."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check if backend dependencies are installed
if ! python3 -c "import fastapi; import cv2; import numpy; import scipy" 2>/dev/null; then
    echo -e "${RED}Error: Python dependencies not installed.${NC}"
    echo "Run: pip install fastapi uvicorn opencv-python numpy scipy python-multipart"
    exit 1
fi

# Check if frontend dependencies are installed
if [ ! -d "$SCRIPT_DIR/app/node_modules" ]; then
    echo -e "${BLUE}Installing frontend dependencies...${NC}"
    cd "$SCRIPT_DIR/app" && npm install
fi

# Function to cleanup background processes on exit
cleanup() {
    echo ""
    echo -e "${BLUE}Shutting down...${NC}"
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    exit 0
}

trap cleanup INT TERM

# Start backend
echo -e "${GREEN}Starting backend on http://localhost:8000${NC}"
cd "$SCRIPT_DIR/backend"
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 2

# Start frontend
echo -e "${GREEN}Starting frontend on http://localhost:3000${NC}"
cd "$SCRIPT_DIR/app"
npm run dev &
FRONTEND_PID=$!

echo ""
echo -e "${GREEN}✓ CosmosCurves is running!${NC}"
echo ""
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:8000"
echo "  API Docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Wait for processes
wait
