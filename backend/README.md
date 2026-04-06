# Ball Trajectory Tracker - Backend

FastAPI backend for the Ball Trajectory Tracker application. Handles session management, frame processing, ball detection, and curve fitting.

## Requirements

- Python 3.11 or higher
- pip package manager

## Installation

```bash
# Navigate to backend directory
cd backend

# Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `fastapi` | Web framework |
| `uvicorn` | ASGI server |
| `opencv-python-headless` | Image processing (no GUI) |
| `numpy` | Numerical operations |
| `scipy` | Curve fitting algorithms |
| `python-multipart` | Handling multipart form data |
| `qrcode[pil]` | QR code generation |
| `reportlab` | PDF calibration sheet generation |

## Running

### Development

```bash
# Run with auto-reload
python main.py

# Or using uvicorn directly
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Production

```bash
# Run without reload
uvicorn main:app --host 0.0.0.0 --port 8000
```

## API Documentation

### Base URL

All endpoints are relative to the base URL (e.g., `http://localhost:8000`).

### Authentication

All endpoints requiring session context use the `X-Session-Code` header.

---

### `POST /session/new`

Create a new experiment session.

**Headers:** None

**Request Body:** None

**Response:**
```json
{
  "session_code": "A4K9XZ",
  "session_id": "uuid-string",
  "qr_code_base64": "iVBORw0KGgo...",
  "capture_url": "https://app.yourdomain.com/capture?session=A4K9XZ"
}
```

**Status Codes:**
- `200`: Session created successfully
- `400`: Error creating session

---

### `GET /calibration-sheet.pdf`

Download a printable calibration sheet (9cm diameter circle).

**Headers:** None

**Response:** PDF file (`Content-Type: application/pdf`)

**Status Codes:**
- `200`: PDF generated successfully
- `400`: Error generating PDF

---

### `POST /calibrate`

Process calibration frame to determine pixels-per-centimeter ratio.

**Headers:**
- `X-Session-Code`: (required) 6-character session code

**Request Body:** Raw JPEG binary

**Response:**
```json
{
  "ok": true,
  "px_per_cm": 14.2,
  "marker_radius_px": 63
}
```

**Error Response:**
```json
{
  "ok": false,
  "error": "No circular marker detected — ensure sheet is fully visible and well-lit"
}
```

**Status Codes:**
- `200`: Calibration successful
- `400`: Calibration failed (no marker detected, missing header)

---

### `POST /setup`

Submit HSV color ranges for ball detection.

**Headers:**
- `X-Session-Code`: (required) 6-character session code

**Request Body:**
```json
{
  "small_ball_hsv": { "h": 45, "s": 180, "v": 220 },
  "sheet_hsv": { "h": 0, "s": 0, "v": 240 },
  "big_ball_hsv": { "h": 20, "s": 200, "v": 180 }
}
```

**Response:**
```json
{
  "small_ball_range": { "h": [30, 60], "s": [140, 220], "v": [180, 255] },
  "big_ball_range": { "h": [5, 35], "s": [160, 240], "v": [140, 220] },
  "accuracy_score": 87,
  "accuracy_label": "Good",
  "ok": true
}
```

**Accuracy Labels:**
- `< 50`: "Poor"
- `50-74`: "Fair"
- `75-89`: "Good"
- `≥ 90`: "Excellent"

**Status Codes:**
- `200`: Setup successful
- `400`: Invalid session or data

---

### `POST /detect_preview`

Single-frame detection for real-time overlay.

**Headers:**
- `X-Session-Code`: (required) 6-character session code

**Request Body:** Raw JPEG binary

**Response:**
```json
{
  "detected": true,
  "x_px": 312,
  "y_px": 480,
  "radius_px": 18,
  "score": 0.82
}
```

**When not detected:**
```json
{
  "detected": false
}
```

**Status Codes:**
- `200`: Detection completed (may or may not have found ball)
- `400`: Invalid session

---

### `POST /frame`

Upload a frame during recording.

**Headers:**
- `X-Session-Code`: (required) 6-character session code
- `X-Frame-Index`: (required) Frame sequence number

**Request Body:** Raw JPEG binary

**Response:**
```json
{
  "ok": true,
  "frame_index": 42
}
```

**Status Codes:**
- `200`: Frame saved successfully
- `400`: Invalid session or missing headers

---

### `POST /stop`

Stop recording and start processing pipeline.

**Headers:**
- `X-Session-Code`: (required) 6-character session code

**Request Body:** `{}` (empty object)

**Response:**
```json
{
  "ok": true,
  "message": "Processing started"
}
```

**Processing Pipeline:**
1. Validate session (calibration, colors, frame count)
2. Score all frames for ball detection quality
3. Select top frames by score
4. Extract coordinates in centimeters
5. Detect big ball center position
6. Fit parabola, ellipse, and hyperbola
7. Determine winning curve (lowest residual)
8. Clean up temporary files
9. Persist results

**Status Codes:**
- `200`: Processing started
- `400`: Invalid session

---

### `GET /status`

Poll session status and progress.

**Headers:**
- `X-Session-Code`: (required) 6-character session code

**Response (idle):**
```json
{
  "status": "idle",
  "calibrated": false,
  "px_per_cm": null,
  "colors_set": false
}
```

**Response (recording):**
```json
{
  "status": "recording",
  "frame_count": 87
}
```

**Response (processing):**
```json
{
  "status": "processing",
  "progress": 0.65,
  "progress_label": "Fitting curves..."
}
```

**Response (done):**
```json
{
  "status": "done",
  "run_id": "run_A4K9XZ_1705312345"
}
```

**Response (error):**
```json
{
  "status": "error",
  "error": "Only 5 frames passed detection threshold"
}
```

**Status Codes:**
- `200`: Status retrieved
- `400`: Invalid session

---

### `GET /runs`

List all saved experiment runs.

**Headers:** None

**Response:**
```json
{
  "runs": [
    {
      "run_id": "run_A4K9XZ_1705312345",
      "session_code": "A4K9XZ",
      "timestamp": "2025-01-15T14:32:00Z",
      "coordinates": [
        { "x_cm": -12.4, "y_cm": 8.1, "frame_index": 7, "score": 0.91 }
      ],
      "big_ball_center": { "x_cm": 1.2, "y_cm": -0.4 },
      "winning_curve": "parabola",
      "residuals": {
        "parabola": 0.023,
        "ellipse": 0.18,
        "hyperbola": 0.41
      },
      "equation": {
        "type": "parabola",
        "coefficients": { "a": 0.032, "b": -0.11, "c": 2.4 },
        "display": "y = 0.032x² - 0.11x + 2.4"
      }
    }
  ]
}
```

---

### `GET /runs/{run_id}`

Get a specific run by ID.

**Headers:** None

**Response:** Single run object (see above)

---

## Data Storage

### Runs (`data/runs.json`)

All experiment runs are persisted to a JSON file:

```json
[
  {
    "run_id": "run_ABC123_1234567890",
    "session_code": "ABC123",
    "timestamp": "2025-01-15T14:32:00Z",
    "coordinates": [...],
    "big_ball_center": {...},
    "winning_curve": "parabola",
    "residuals": {...},
    "equation": {...}
  }
]
```

### Sessions (`data/sessions/{uuid}/frames/`)

During recording, frames are temporarily stored in session directories. These are deleted after processing.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `0.0.0.0` | Server host |
| `PORT` | `8000` | Server port |
| `DEBUG` | `false` | Enable debug mode |

### Detection Constants

Located in `detection.py`:

```python
MIN_CONTOUR_AREA_PX = 100    # Minimum contour area (pixels)
MIN_CIRCULARITY = 0.70       # Minimum circularity (0-1)
MIN_DETECTION_SCORE = 0.40   # Minimum score for valid frame
TARGET_FRAMES = 25           # Number of frames to analyze
MIN_VALID_FRAMES = 10        # Minimum frames required
```

### Calibration Constants

Located in `calibration.py`:

```python
MARKER_DIAMETER_CM = 9.0     # Calibration marker diameter
```

## Deployment

### Replit Deployment

1. Create a new Replit project (Python template)
2. Copy all backend files
3. Add `.replit` configuration:

```toml
[nix]
channel = "stable-23_11"

[deployment]
run = ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]

[[ports]]
localPort = 8080
externalPort = 443
```

4. Add `replit.nix`:

```nix
{ pkgs }: {
  deps = [
    pkgs.python311
    pkgs.python311Packages.pip
    pkgs.libGL
    pkgs.libGLU
    pkgs.glib
  ];
}
```

5. Click "Run" and copy the HTTPS URL
6. Enable "Always On" in settings for continuous availability

### Docker Deployment

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```bash
docker build -t ball-tracker-backend .
docker run -p 8000:8000 ball-tracker-backend
```

### CORS Configuration

The server allows all origins by default. For production, restrict in `main.py`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://yourdomain.com"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Testing

### Running Tests

```bash
# Run synthetic test pipeline
python test_pipeline.py

# Run with pytest (if available)
pytest
```

### Test Pipeline

The `test_pipeline.py` script:
1. Creates a new session
2. Sends calibration frames
3. Streams 30 synthetic frames (orange ball on parabolic path)
4. Verifies the winning curve is parabola

## Troubleshooting

### Common Issues

1. **"Failed to decode image"**
   - Ensure frames are valid JPEG format
   - Check Content-Type header is `image/jpeg`

2. **"Session not found"**
   - Verify `X-Session-Code` header matches a valid session
   - Sessions are in-memory; lost on server restart

3. **OpenCV import errors on Replit**
   - Use `opencv-python-headless` (not `opencv-python`)
   - Ensure all nix dependencies are installed

4. **High memory usage**
   - Frame directories grow during recording
   - Frames are deleted after processing
   - Consider limiting frame rate on client

## Architecture

```
main.py
├── /session/new    → Create session, generate QR
├── /calibrate      → Process calibration marker
├── /setup          → Store HSV ranges
├── /detect_preview → Real-time detection overlay
├── /frame          → Store frames during recording
├── /stop           → Trigger processing pipeline
├── /status         → Poll progress
└── /runs           → List/load results

calibration.py
└── process_calibration_frame() → Detect circular marker, compute px/cm

detection.py
├── compute_hsv_ranges() → Convert color samples to HSV bounds
└── detect_ball_in_frame() → Find ball in frame using HSV mask

curve_fitting.py
└── fit_curves() → Fit parabola/ellipse/hyperbola, return winner

session.py
└── SessionState → In-memory session management

storage.py
├── init_storage()  → Create data directories
├── get_all_runs()  → Load runs.json
├── append_run()    → Append to runs.json (thread-safe)
└── get_run_by_id() → Get specific run
```

## License

MIT License - See main project README for details.