# CosmosCurves - Ball Trajectory Tracker

A two-device physics experiment tool for tracking and analyzing ball trajectories. The phone PWA captures ball motion via the rear camera, streams frames to a cloud-hosted FastAPI backend, and the laptop PWA controls the recording session and visualizes results including curve fitting (parabola, ellipse, hyperbola).

![CosmosCurves Architecture](https://img.shields.io/badge/Platform-iOS%20%7C%20Android%20%7C%20Desktop-blue)
![Python](https://img.shields.io/badge/Python-3.11+-green)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-teal)

## Features

- **Two-Device Workflow**: Phone captures, laptop controls and visualizes
- **QR Code Session Linking**: No IP addresses or manual coordination needed
- **Real-time Detection Overlay**: Live ball position feedback during setup
- **Automatic Calibration**: Print a calibration sheet for accurate cm measurements
- **HSV Color Sampling**: Tap on screen to sample ball colors for detection
- **Curve Fitting**: Automatic fitting to parabola, ellipse, or hyperbola
- **Interactive Visualization**: Zoom, pan, and explore trajectory data
- **Progressive Web Apps**: Install on phone and laptop for native-like experience

## Architecture

```
┌──────────────────┐                    ┌──────────────────┐
│   Laptop PWA     │                    │   Phone PWA      │
│   (Vercel)       │                    │   (Vercel)       │
│                  │                    │                  │
│ - New Session    │                    │ - Camera Capture │
│ - QR Display     │                    │ - Calibration    │
│ - Status Poll    │                    │ - Color Sampling │
│ - Results Grid   │                    │ - Frame Stream   │
└────────┬─────────┘                    └────────┬─────────┘
         │                                       │
         │ HTTPS                                 │ HTTPS
         │ REST API                              │ POST frames
         ▼                                       ▼
    ┌─────────────────────────────────────────────────┐
    │            FastAPI Backend (Replit)              │
    │                                                  │
    │  /session/new → QR + session code                │
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

### Prerequisites

- Python 3.11 or higher
- A smartphone with a camera
- A laptop or desktop computer
- A printer (for calibration sheet)

### Backend Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/harshitsinghbhandari/cosmic-curves.git
   cd cosmic-curves
   ```

2. **Install Python dependencies**
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

3. **Run the server**
   ```bash
   python main.py
   # or
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```

4. **For production**, deploy to Replit or any cloud provider:
   - See [backend/README.md](backend/README.md) for detailed deployment instructions

### Phone PWA Setup

1. Open `phone-pwa/` in a web server or deploy to Vercel
2. Update `API_BASE` in `app.js` to point to your backend URL
3. Open on phone browser and add to home screen for PWA experience

### Laptop PWA Setup

1. Open `laptop-pwa/` in a web server or deploy to Vercel
2. Update `API_BASE` in `app.js` to point to your backend URL
3. Open in browser and add to home screen/bookmark for quick access

## Usage

### 1. Start a Session (Laptop)

1. Open the laptop PWA
2. Click **"New Session"**
3. A QR code and 6-character session code will be displayed

### 2. Join Session (Phone)

**Option A: Scan QR Code**
- Point phone camera at QR code
- Open the link

**Option B: Manual Entry**
- Open phone PWA
- Enter the 6-character session code

### 3. Calibration (Phone)

1. Print the calibration sheet from `/calibration-sheet.pdf`
2. Place it in the camera frame
3. Tap **"Capture Marker"**
4. Wait for calibration confirmation

### 4. Color Sampling (Phone)

1. Follow the on-screen prompts:
   - Tap on the **small ball** (the one being thrown)
   - Tap on the **sheet/background**
   - Tap on the **big ball** (stationary reference)
2. Wait for accuracy score
3. Click **"Go to Record"** if accuracy is acceptable (≥60%)

### 5. Recording (Phone)

1. Position phone to capture the experiment area
2. Press **RECORD** button to start
3. Perform your experiment (throw the ball)
4. Press **RECORD** button again to stop
5. Wait for processing to complete

### 6. View Results (Laptop)

1. Results automatically load after processing
2. Explore the trajectory visualization:
   - **Scroll** to zoom
   - **Drag** to pan
   - **Hover** over dots to see coordinates
   - Click **👁** to toggle run visibility
   - Click color swatch to change run color
3. View the fitted equation and residuals
4. Click **"+ New Run"** to start another experiment

## Project Structure

```
cosmoscurves/
├── README.md                    # This file
├── spec.md                      # Detailed specification
├── backend/                     # FastAPI Python backend
│   ├── main.py                  # Main application entry point
│   ├── calibration.py           # Calibration marker detection
│   ├── detection.py              # Ball detection using HSV masks
│   ├── curve_fitting.py          # Parabola/ellipse/hyperbola fitting
│   ├── session.py                # Session state management
│   ├── storage.py                # JSON file persistence
│   ├── requirements.txt          # Python dependencies
│   └── data/                     # Runtime data storage
│       ├── runs.json             # Persisted run data
│       └── sessions/             # Session frame storage
├── phone-pwa/                    # Phone capture app
│   ├── index.html                # Main HTML structure
│   ├── app.js                    # Camera capture and streaming
│   ├── style.css                 # Mobile-optimized styling
│   ├── manifest.json             # PWA manifest
│   └── sw.js                      # Service worker (offline support)
└── laptop-pwa/                   # Laptop control/results app
    ├── index.html                # Main HTML structure
    ├── app.js                    # Session management
    ├── grid.js                   # Canvas visualization
    ├── style.css                 # Desktop styling
    ├── manifest.json             # PWA manifest
    └── sw.js                      # Service worker (offline support)
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/session/new` | POST | Create new session, get QR code |
| `/calibration-sheet.pdf` | GET | Download printable calibration sheet |
| `/calibrate` | POST | Process calibration frame |
| `/setup` | POST | Submit HSV color ranges |
| `/detect_preview` | POST | Real-time ball detection for overlay |
| `/frame` | POST | Upload frame during recording |
| `/stop` | POST | Stop recording, start processing |
| `/status` | GET | Poll session status/progress |
| `/runs` | GET | List all saved runs |
| `/runs/{run_id}` | GET | Get specific run details |

See [backend/README.md](backend/README.md) for detailed API documentation.

## Configuration

### Backend Constants

Located in `backend/detection.py`:

```python
MIN_CONTOUR_AREA_PX = 100      # Minimum contour area for detection
MIN_CIRCULARITY = 0.70         # Minimum circularity threshold
MIN_DETECTION_SCORE = 0.40     # Minimum score for valid frame
TARGET_FRAMES = 25             # Number of frames to analyze
MIN_VALID_FRAMES = 10          # Minimum frames required
```

### Phone PWA Constants

Located in `phone-pwa/app.js`:

```javascript
const FPS = 15;                           // Recording frame rate
const JPEG_QUALITY = 0.85;                 // Image compression quality
const PREVIEW_INTERVAL_MS = 200;           // Detection overlay interval
```

### Laptop PWA Constants

Located in `laptop-pwa/grid.js`:

```javascript
const GRID_RANGE_CM = 45;                 // Visible range in cm
const GRID_MAJOR_STEP_CM = 10;            // Major grid line interval
const DOT_RADIUS_PX = 4;                  // Data point size
```

## Technology Stack

### Backend
- **Python 3.11+** - Programming language
- **FastAPI** - Modern async web framework
- **Uvicorn** - ASGI server
- **OpenCV** - Image processing
- **NumPy/SciPy** - Numerical computations and curve fitting
- **qrcode[pil]** - QR code generation
- **reportlab** - PDF generation for calibration sheets

### Frontend
- **Vanilla JavaScript** - No frameworks, fast loading
- **HTML5 Canvas** - Camera overlay and visualization
- **CSS3** - Modern responsive styling
- **PWA Manifest** - Installable web apps
- **Service Worker** - Offline capability

## Deployment

### Backend (Replit Recommended)

1. Create a new Replit project with Python template
2. Copy all backend files
3. Add `.replit` and `replit.nix` configuration
4. Set environment variables if needed
5. Enable "Always On" for continuous availability

### Frontend (Vercel Recommended)

1. Connect repository to Vercel
2. Deploy `phone-pwa/` and `laptop-pwa/` as separate projects
3. Update `API_BASE` to point to backend URL

See individual README files for detailed deployment instructions.

## Physics Background

This tool helps analyze projectile motion and conic sections:

- **Parabola**: Typical trajectory under uniform gravity (projectile motion)
- **Ellipse**: Closed orbit around a central mass (Kepler's first law)
- **Hyperbola**: Unbound trajectory with excess energy

The backend uses least-squares fitting to find the best curve and reports residuals for comparison.

## Troubleshooting

### Common Issues

1. **"No circular marker detected"**
   - Ensure calibration sheet is fully visible
   - Improve lighting conditions
   - Make sure the circle is not distorted by perspective

2. **Low accuracy score (<60%)**
   - Re-sample colors with better lighting
   - Ensure the small ball color is distinct from background
   - Avoid shadows and reflections

3. **"Only X frames passed detection threshold"**
   - Record longer clips
   - Ensure ball is moving slowly enough to capture
   - Check lighting and color sampling

4. **Connection errors**
   - Verify backend is running and accessible
   - Check `API_BASE` URL in frontend files
   - Ensure CORS is properly configured

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is open source and available under the [MIT License](LICENSE).

## Acknowledgments

- OpenCV community for computer vision algorithms
- FastAPI for the excellent async web framework
- The physics education community for inspiration