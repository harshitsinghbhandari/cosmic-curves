# CosmosCurves - Ball Trajectory Tracker

A two-device physics experiment tool for tracking and analyzing ball trajectories. The phone PWA captures ball motion via the rear camera, streams frames to a FastAPI backend, and the laptop PWA controls the recording session and visualizes results including curve fitting (parabola, ellipse, hyperbola).

![CosmosCurves](https://img.shields.io/badge/Platform-iOS%20%7C%20Android%20%7C%20Desktop-blue)
![Python](https://img.shields.io/badge/Python-3.11+-green)
![React](https://img.shields.io/badge/React-19-61DAFB)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-teal)

## Features

- **Two-Device Workflow**: Phone captures, laptop controls and visualizes
- **Visual Step-by-Step Setup**: Progress stepper guides users through calibration → colors → recording
- **Real-time Detection Overlay**: Live ball position feedback with quality indicators
- **Haptic Feedback**: Vibration on color sampling taps
- **Human-Friendly Labels**: No technical jargon - "Excellent detection quality" instead of "87%"
- **Live Upload Progress**: See frame upload count and network health in real-time
- **Interactive Canvas**: Zoom/pan with HUD overlay showing zoom level and controls
- **Curve Fitting**: Automatic fitting to parabola, ellipse, or hyperbola with residual comparison
- **Progressive Web Apps**: Install on phone and laptop for native-like experience

## Architecture

```
┌──────────────────┐                    ┌──────────────────┐
│   Laptop PWA     │                    │   Phone PWA      │
│   (Vercel)       │                    │   (Vercel)       │
│                  │                    │                  │
│ - New Session    │                    │ - Camera Capture │
│ - QR Display     │                    │ - Step Stepper   │
│ - Canvas HUD     │                    │ - Color Swatches │
│ - Results Grid   │                    │ - Upload Progress│
└────────┬─────────┘                    └────────┬─────────┘
         │                                       │
         │ HTTPS                                 │ HTTPS
         │ REST API                              │ POST frames
         ▼                                       ▼
    ┌─────────────────────────────────────────────────┐
    │            FastAPI Backend (Render)             │
    │                                                 │
    │  /session/new → QR + session code               │
    │  /calibrate → px/cm ratio                       │
    │  /setup → HSV ranges                            │
    │  /detect_preview → real-time overlay            │
    │  /frame → store JPEGs                           │
    │  /stop → background pipeline                    │
    │  /status → progress polling                     │
    │  /runs → load results                           │
    └─────────────────────────────────────────────────┘
```

## Quick Start

### Local Development

```bash
# Clone and install
git clone https://github.com/harshitsinghbhandari/cosmoscurves.git
cd cosmoscurves
npm install --legacy-peer-deps

# Start everything (backend + both PWAs)
./test.sh
```

This starts:
- Backend API at http://localhost:8000
- Laptop PWA at http://localhost:3000
- Phone PWA at http://localhost:3001

### Testing Flow

1. Open http://localhost:3000 (laptop app)
2. Click "New Session" - see QR code
3. Open http://localhost:3001?session=XXXXXX (replace with actual code)
4. On phone: Calibrate → Sample colors → Record
5. On laptop: View trajectory results

## Deployment

### Frontend (Vercel)

The frontend is already configured. Just push to GitHub and Vercel auto-deploys.

**No changes needed on Vercel** - the `.env.production` files are already set up.

### Backend (Render)

**Set these environment variables on Render:**

| Variable | Value |
|----------|-------|
| `ENV` | `production` |
| `PHONE_PWA_URL` | `https://cosmic-curves.vercel.app/phone` |
| `LAPTOP_PWA_URL` | `https://cosmic-curves.vercel.app/laptop` |

**Render Build Settings:**
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`

## Environment Configuration

The app auto-switches between dev and prod URLs:

| Environment | Backend | Phone PWA | Laptop PWA |
|-------------|---------|-----------|------------|
| Development | `localhost:8000` | `localhost:3001` | `localhost:3000` |
| Production | `cosmic-curves.onrender.com` | `cosmic-curves.vercel.app/phone` | `cosmic-curves.vercel.app/laptop` |

**Files:**
- `phone-pwa/.env.production` - Production API URL
- `laptop-pwa/.env.production` - Production API URL
- `backend/config.py` - All URL configuration

## Project Structure

```
cosmoscurves/
├── backend/                     # FastAPI Python backend
│   ├── main.py                  # Main application
│   ├── config.py                # Environment configuration
│   ├── calibration.py           # Marker detection
│   ├── detection.py             # Ball detection (HSV)
│   ├── curve_fitting.py         # Parabola/ellipse/hyperbola
│   └── requirements.txt         # Python dependencies
├── phone-pwa/                   # Phone capture app (React + Vite)
│   ├── src/App.jsx              # Main component with stepper, color swatches
│   ├── src/config.js            # API URL configuration
│   └── .env.production          # Production URLs
├── laptop-pwa/                  # Laptop control app (React + Vite)
│   ├── src/App.jsx              # Main component with HUD, legend
│   ├── src/lib/grid.js          # Canvas visualization
│   ├── src/config.js            # API URL configuration
│   └── .env.production          # Production URLs
├── test.sh                      # Development testing script
├── deploy.sh                    # Deployment helper script
└── vercel.json                  # Vercel routing configuration
```

## Scripts

```bash
./test.sh           # Start all services for local testing
./test.sh backend   # Run automated backend test
./test.sh build     # Build and check for errors
./test.sh check     # Check if services are running

./deploy.sh build   # Build for production
./deploy.sh info    # Show deployment architecture
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/session/new` | POST | Create session, returns QR code |
| `/calibrate` | POST | Process calibration frame |
| `/setup` | POST | Submit HSV color ranges |
| `/detect_preview` | POST | Real-time ball detection |
| `/frame` | POST | Upload frame during recording |
| `/stop` | POST | Stop recording, start analysis |
| `/status` | GET | Poll session status/progress |
| `/runs` | GET | List all saved runs |

## Recent UX Improvements

### Phone PWA
- ✅ Visual stepper (Calibrate → Colors → Record)
- ✅ Tap ripple animation + haptic feedback
- ✅ Color swatches with labels (Small Ball, Background, Big Ball)
- ✅ Quality indicator bar with human-friendly labels
- ✅ Recording stats panel (timer, frames, buffered, network health)
- ✅ Upload progress with "X of Y frames" counter

### Laptop PWA
- ✅ Lucide icons (no more emojis)
- ✅ Improved grid visibility (better opacity)
- ✅ Canvas HUD (zoom level, reset button, keyboard hints)
- ✅ Visualization legend
- ✅ Residuals panel expanded by default with winning curve badge
- ✅ Full ARIA accessibility labels

## Troubleshooting

### "Camera not working"
- Ensure HTTPS (required for camera access)
- Check browser permissions

### "No circular marker detected"
- Ensure calibration sheet is fully visible
- Improve lighting

### Low accuracy score
- Re-sample colors with better lighting
- Ensure ball color is distinct from background

### Connection errors
- Check backend is running
- Verify environment URLs match

## License

MIT License - see [LICENSE](LICENSE)
