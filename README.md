# CosmosCurves

Ball trajectory tracking using computer vision. Turn any phone into a physics lab.

## What It Does

1. **Connect** your phone as an IP camera
2. **Calibrate** by clicking to sample marker and ball colors
3. **Record** the ball in motion
4. **Analyze** - get fitted curves (parabola, linear, polynomial) with equations

## Quick Start

```bash
# Clone
git clone https://github.com/harshitsinghbhandari/cosmic-curves.git
cd cosmic-curves

# Install
cd app && npm install
cd ../backend && pip install -r requirements.txt

# Run
cd .. && ./start.sh
```

Opens:
- Frontend: http://localhost:3000
- Backend: http://localhost:8000

## Requirements

- **Phone**: Any IP camera app (IP Webcam, DroidCam, etc.)
- **Computer**: Python 3.11+, Node.js 18+

## Project Structure

```
cosmic-curves/
├── app/                  # React frontend (Vite)
│   ├── src/App.jsx       # Main application
│   └── src/lib/grid.js   # Canvas visualization
├── backend/              # FastAPI backend
│   ├── main.py           # API endpoints
│   ├── detection.py      # Ball detection (OpenCV)
│   └── curve_fitting.py  # Curve fitting
├── landing/              # Landing page (Vercel)
└── start.sh              # Launch script
```

## How It Works

1. Phone streams video over local network (MJPEG)
2. Frontend captures frames and sends to backend
3. Backend detects balls using Euclidean distance masking in BGR color space
4. Detected positions are converted to cm using calibrated scale
5. Curve fitting finds best-fit parabola/line with R² score

## Tech Stack

- **Frontend**: React, Vite, Canvas API
- **Backend**: FastAPI, OpenCV, NumPy
- **Detection**: Color-based blob detection with morphological operations

## License

MIT
