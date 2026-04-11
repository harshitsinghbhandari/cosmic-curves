#!/bin/bash
# ===========================================
# CosmosCurves - Test Script
# ===========================================
# This script helps you test the full application
# ===========================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              CosmosCurves Test Runner                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Function to cleanup background processes on exit
cleanup() {
    echo -e "\n${YELLOW}Shutting down all services...${NC}"
    kill $(jobs -p) 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

# Check dependencies
echo -e "${YELLOW}Checking dependencies...${NC}"

if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: python3 not found. Please install Python 3.${NC}"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm not found. Please install Node.js.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Dependencies OK${NC}\n"

# Parse arguments
MODE="${1:-full}"

case "$MODE" in
    # ===========================================
    # OPTION 1: Run synthetic backend test only
    # ===========================================
    backend)
        echo -e "${BLUE}=== Backend Synthetic Test ===${NC}"
        echo "This runs a quick automated test with fake frames."
        echo ""

        # Check if backend deps are installed
        if [ ! -d "backend/venv" ] && ! pip3 show fastapi &>/dev/null; then
            echo -e "${YELLOW}Installing backend dependencies...${NC}"
            cd backend
            pip3 install -r requirements.txt 2>/dev/null || pip3 install fastapi uvicorn opencv-python numpy qrcode pillow reportlab
            cd ..
        fi

        echo -e "${YELLOW}Starting backend server...${NC}"
        cd backend
        python3 -m uvicorn main:app --host 127.0.0.1 --port 8000 &
        BACKEND_PID=$!
        cd ..

        # Wait for backend to start
        echo "Waiting for backend to start..."
        sleep 3

        # Check if backend is running
        if ! curl -s http://127.0.0.1:8000/docs > /dev/null; then
            echo -e "${RED}Backend failed to start!${NC}"
            exit 1
        fi
        echo -e "${GREEN}✓ Backend running at http://127.0.0.1:8000${NC}"

        echo -e "\n${YELLOW}Running synthetic pipeline test...${NC}\n"
        cd backend
        python3 test_pipeline.py
        TEST_EXIT=$?
        cd ..

        kill $BACKEND_PID 2>/dev/null || true

        if [ $TEST_EXIT -eq 0 ]; then
            echo -e "\n${GREEN}✓ Backend test PASSED!${NC}"
        else
            echo -e "\n${RED}✗ Backend test FAILED!${NC}"
            exit 1
        fi
        ;;

    # ===========================================
    # OPTION 2: Build and check for errors
    # ===========================================
    build)
        echo -e "${BLUE}=== Build Test ===${NC}"
        echo "Building all frontends to check for errors..."
        echo ""

        echo -e "${YELLOW}Installing dependencies...${NC}"
        npm install --legacy-peer-deps

        echo -e "\n${YELLOW}Building laptop-pwa...${NC}"
        npm run build -w laptop-pwa

        echo -e "\n${YELLOW}Building phone-pwa...${NC}"
        npm run build -w phone-pwa

        echo -e "\n${GREEN}✓ All builds successful!${NC}"
        echo -e "Output in: ${BLUE}public/laptop${NC} and ${BLUE}public/phone${NC}"
        ;;

    # ===========================================
    # OPTION 3: Start all services for manual testing
    # ===========================================
    full|dev)
        echo -e "${BLUE}=== Full Development Mode ===${NC}"
        echo "Starting all services for manual testing..."
        echo ""

        # Install dependencies if needed
        if [ ! -d "node_modules" ]; then
            echo -e "${YELLOW}Installing npm dependencies...${NC}"
            npm install --legacy-peer-deps
        fi

        # Start backend (with ENV=development)
        echo -e "${YELLOW}Starting backend server on port 8000...${NC}"
        cd backend
        ENV=development python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
        cd ..
        sleep 2

        # Start laptop PWA
        echo -e "${YELLOW}Starting laptop PWA on port 3000...${NC}"
        npm run dev -w laptop-pwa &
        sleep 2

        # Start phone PWA
        echo -e "${YELLOW}Starting phone PWA on port 3001...${NC}"
        npm run dev -w phone-pwa &
        sleep 2

        echo ""
        echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║                    ALL SERVICES RUNNING                       ║${NC}"
        echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "  ${BLUE}Backend API:${NC}    http://localhost:8000"
        echo -e "  ${BLUE}API Docs:${NC}       http://localhost:8000/docs"
        echo -e "  ${BLUE}Laptop App:${NC}     http://localhost:3000"
        echo -e "  ${BLUE}Phone App:${NC}      http://localhost:3001"
        echo ""
        echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
        echo -e "${YELLOW}HOW TO TEST:${NC}"
        echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
        echo ""
        echo "  1. Open ${BLUE}http://localhost:3000${NC} in your browser (laptop app)"
        echo "  2. Click 'New Session' - you'll see a QR code"
        echo "  3. Either:"
        echo "     a) Scan QR with your phone, OR"
        echo "     b) Open ${BLUE}http://localhost:3001?session=XXXXXX${NC}"
        echo "        (replace XXXXXX with the session code shown)"
        echo ""
        echo "  4. On phone: Allow camera access"
        echo "  5. On phone: Tap 'Capture Marker' (calibration step)"
        echo "  6. On phone: Tap small ball, background, big ball (color setup)"
        echo "  7. On phone: Tap record button to start/stop recording"
        echo "  8. On laptop: View the results with trajectory visualization"
        echo ""
        echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
        echo ""

        # Wait for Ctrl+C
        wait
        ;;

    # ===========================================
    # OPTION 4: Quick health check
    # ===========================================
    check)
        echo -e "${BLUE}=== Quick Health Check ===${NC}"
        echo ""

        # Check backend
        echo -n "Backend (port 8000): "
        if curl -s http://127.0.0.1:8000/docs > /dev/null 2>&1; then
            echo -e "${GREEN}✓ Running${NC}"
        else
            echo -e "${RED}✗ Not running${NC}"
        fi

        # Check laptop PWA
        echo -n "Laptop PWA (port 3000): "
        if curl -s http://127.0.0.1:3000 > /dev/null 2>&1; then
            echo -e "${GREEN}✓ Running${NC}"
        else
            echo -e "${RED}✗ Not running${NC}"
        fi

        # Check phone PWA
        echo -n "Phone PWA (port 3001): "
        if curl -s http://127.0.0.1:3001 > /dev/null 2>&1; then
            echo -e "${GREEN}✓ Running${NC}"
        else
            echo -e "${RED}✗ Not running${NC}"
        fi
        ;;

    *)
        echo "Usage: ./test.sh [mode]"
        echo ""
        echo "Modes:"
        echo "  full, dev   Start all services for manual testing (default)"
        echo "  backend     Run automated backend test with synthetic frames"
        echo "  build       Build all frontends and check for errors"
        echo "  check       Quick health check of running services"
        echo ""
        echo "Examples:"
        echo "  ./test.sh           # Start everything for manual testing"
        echo "  ./test.sh backend   # Run quick automated backend test"
        echo "  ./test.sh build     # Just build and check for errors"
        ;;
esac
