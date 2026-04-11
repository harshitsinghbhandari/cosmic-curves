#!/bin/bash
# ===========================================
# CosmosCurves - Deploy Script
# ===========================================
# Builds and deploys the application
# ===========================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              CosmosCurves Deploy Script                      ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

MODE="${1:-build}"

case "$MODE" in
    # ===========================================
    # Build for production
    # ===========================================
    build)
        echo -e "${YELLOW}Building for production...${NC}\n"

        # Install dependencies
        echo -e "${BLUE}Step 1/3: Installing dependencies...${NC}"
        npm install --legacy-peer-deps

        # Build both PWAs
        echo -e "\n${BLUE}Step 2/3: Building frontends...${NC}"
        npm run build

        echo -e "\n${BLUE}Step 3/3: Build complete!${NC}"
        echo ""
        echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║                    BUILD SUCCESSFUL                          ║${NC}"
        echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        echo "Output files:"
        echo "  public/laptop/  - Laptop PWA (serve at /laptop)"
        echo "  public/phone/   - Phone PWA (serve at /phone)"
        echo "  public/index.html - Root redirect page"
        echo ""
        echo "To deploy:"
        echo "  1. Vercel: Run 'vercel' or push to GitHub"
        echo "  2. Manual: Upload 'public/' folder to your static host"
        echo "  3. Backend: Deploy 'backend/' to a Python hosting service"
        ;;

    # ===========================================
    # Deploy to Vercel (frontends only)
    # ===========================================
    vercel)
        echo -e "${YELLOW}Deploying to Vercel...${NC}\n"

        if ! command -v vercel &> /dev/null; then
            echo -e "${RED}Error: Vercel CLI not found.${NC}"
            echo "Install with: npm i -g vercel"
            exit 1
        fi

        # Build first
        echo -e "${BLUE}Building...${NC}"
        npm install --legacy-peer-deps
        npm run build

        # Deploy
        echo -e "\n${BLUE}Deploying to Vercel...${NC}"
        vercel --prod

        echo -e "\n${GREEN}✓ Deployed to Vercel!${NC}"
        ;;

    # ===========================================
    # Deploy backend to fly.io
    # ===========================================
    backend)
        echo -e "${YELLOW}Preparing backend for deployment...${NC}\n"

        cd backend

        # Check if fly.toml exists
        if [ ! -f "fly.toml" ]; then
            echo -e "${BLUE}Creating fly.toml configuration...${NC}"
            cat > fly.toml << 'EOF'
app = "cosmoscurves-api"
primary_region = "sjc"

[build]
  builder = "paketobuildpacks/builder:base"

[env]
  PORT = "8000"

[http_service]
  internal_port = 8000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512
EOF
            echo -e "${GREEN}✓ Created fly.toml${NC}"
        fi

        # Check if Procfile exists
        if [ ! -f "Procfile" ]; then
            echo "web: uvicorn main:app --host 0.0.0.0 --port \$PORT" > Procfile
            echo -e "${GREEN}✓ Created Procfile${NC}"
        fi

        # Check if requirements.txt exists
        if [ ! -f "requirements.txt" ]; then
            cat > requirements.txt << 'EOF'
fastapi>=0.100.0
uvicorn[standard]>=0.23.0
python-multipart>=0.0.6
opencv-python-headless>=4.8.0
numpy>=1.24.0
qrcode[pil]>=7.4
Pillow>=10.0.0
reportlab>=4.0.0
EOF
            echo -e "${GREEN}✓ Created requirements.txt${NC}"
        fi

        echo ""
        echo -e "${GREEN}Backend is ready for deployment!${NC}"
        echo ""
        echo "To deploy to Fly.io:"
        echo "  1. Install flyctl: curl -L https://fly.io/install.sh | sh"
        echo "  2. Login: flyctl auth login"
        echo "  3. Deploy: cd backend && flyctl deploy"
        echo ""
        echo "Alternative platforms:"
        echo "  - Railway: railway up"
        echo "  - Render: Connect GitHub repo"
        echo "  - DigitalOcean App Platform: Connect repo"

        cd ..
        ;;

    # ===========================================
    # Full deployment info
    # ===========================================
    info)
        echo -e "${BLUE}Deployment Architecture${NC}"
        echo ""
        echo "┌─────────────────────────────────────────────────────────────┐"
        echo "│                    CosmosCurves Stack                       │"
        echo "├─────────────────────────────────────────────────────────────┤"
        echo "│                                                             │"
        echo "│   ┌─────────────┐        ┌─────────────┐                   │"
        echo "│   │  Laptop     │        │   Phone     │                   │"
        echo "│   │  Browser    │        │   Browser   │                   │"
        echo "│   └──────┬──────┘        └──────┬──────┘                   │"
        echo "│          │                      │                          │"
        echo "│          ▼                      ▼                          │"
        echo "│   ┌─────────────────────────────────────┐                  │"
        echo "│   │         Vercel (Static PWAs)        │                  │"
        echo "│   │   /laptop → Laptop PWA              │                  │"
        echo "│   │   /phone  → Phone PWA               │                  │"
        echo "│   └──────────────────┬──────────────────┘                  │"
        echo "│                      │ API calls                           │"
        echo "│                      ▼                                     │"
        echo "│   ┌─────────────────────────────────────┐                  │"
        echo "│   │      Fly.io / Railway / Render      │                  │"
        echo "│   │         Python FastAPI Backend      │                  │"
        echo "│   │   - Session management              │                  │"
        echo "│   │   - Frame processing                │                  │"
        echo "│   │   - Ball detection (OpenCV)         │                  │"
        echo "│   │   - Curve fitting                   │                  │"
        echo "│   └─────────────────────────────────────┘                  │"
        echo "│                                                             │"
        echo "└─────────────────────────────────────────────────────────────┘"
        echo ""
        echo -e "${YELLOW}Quick Deploy Commands:${NC}"
        echo ""
        echo "  # Build everything"
        echo "  ./deploy.sh build"
        echo ""
        echo "  # Deploy frontend to Vercel"
        echo "  ./deploy.sh vercel"
        echo ""
        echo "  # Prepare backend for deployment"
        echo "  ./deploy.sh backend"
        echo ""
        ;;

    *)
        echo "Usage: ./deploy.sh [command]"
        echo ""
        echo "Commands:"
        echo "  build     Build all frontends for production (default)"
        echo "  vercel    Deploy frontends to Vercel"
        echo "  backend   Prepare backend for deployment"
        echo "  info      Show deployment architecture"
        echo ""
        ;;
esac
