# Ball Trajectory Tracker — AI Agent Coding Spec v2
### Architecture: Vercel (PWAs) + Replit (Backend) + QR Session Linking

---

## Overview

A two-device physics experiment tool. A phone PWA captures ball motion via rear camera and streams frames to a cloud-hosted FastAPI backend on Replit. A laptop PWA connects to the same backend to control recording and view results. No local setup, no IP addresses, no terminal commands.

**Devices:**
- **Phone** — capture device (rear camera, overhead fixed mount)
- **Laptop** — control and results device

**Hosting:**
| Component | Platform | URL pattern |
|---|---|---|
| Phone PWA | Vercel | `https://app.yourdomain.com/capture` |
| Laptop PWA | Vercel | `https://app.yourdomain.com` |
| FastAPI Backend | Replit Reserved VM | `https://ball-tracker.yourusername.repl.co` |

**Communication:**
- Phone → Replit Backend: HTTPS POST frames at 15fps
- Laptop → Replit Backend: HTTPS REST (session control, results)
- Phone ↔ Laptop: linked via shared session code (no direct connection)

---

## Repository Structure

```
ball-tracker/
├── phone-pwa/                  # Phone capture app (deployed to Vercel)
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── manifest.json
├── laptop-pwa/                 # Laptop control + results app (deployed to Vercel)
│   ├── index.html
│   ├── app.js
│   ├── grid.js
│   ├── style.css
│   └── manifest.json
├── backend/                    # FastAPI server (deployed to Replit)
│   ├── main.py
│   ├── calibration.py
│   ├── detection.py
│   ├── curve_fitting.py
│   ├── storage.py
│   ├── session.py
│   └── requirements.txt
└── README.md
```

---

## Part 0 — Session Linking (Zero Friction)

### Problem
Phone and laptop must operate on the same experiment session without the user entering IP addresses or manually coordinating devices.

### Solution — Short Session Code + QR

1. User opens laptop PWA → clicks "New Session"
2. Laptop POSTs to `/session/new` → backend returns a **6-character alphanumeric session code** (e.g. `A4K9XZ`) and a **session UUID**
3. Laptop displays:
   - The session code in large type: **`A4K9XZ`**
   - A QR code encoding `https://app.yourdomain.com/capture?session=A4K9XZ`
4. User scans QR with phone camera (or types code into phone PWA manually)
5. Phone opens capture PWA with session code pre-filled in URL param
6. Both devices are now linked to the same backend session

**Session code lives in:**
- URL param on phone: `?session=A4K9XZ`
- `localStorage` on laptop: `activeSession`
- All subsequent API calls include header: `X-Session-Code: A4K9XZ`

**Backend maps:** `session_code → session_uuid → session state + frame storage`

---

## Part 1 — Phone PWA

### 1.1 Tech Stack
- Vanilla JS, HTML5, CSS3
- PWA (`manifest.json` + service worker)
- `getUserMedia` with `facingMode: environment`
- `<canvas>` for frame capture and overlay
- `fetch` for HTTPS POST to Replit backend

### 1.2 Entry Point

On load, read `?session=` from URL:
- If present: skip session entry, go directly to Setup Screen with session code pre-filled
- If absent: show a single input field — "Enter session code from laptop" — and a "Join" button

### 1.3 Screens & Flow

```
App Load
  └── [session code from URL or manual entry]
        └── Setup Screen
              ├── Live rear camera viewfinder (full-screen canvas)
              ├── Step 1: Calibration capture
              ├── Step 2: Color sampling (small ball → sheet → big ball)
              ├── Accuracy score display
              └── Record Screen
                    ├── Live viewfinder + detection overlay
                    ├── Record / Stop button
                    ├── Session timer + frame counter
                    └── "Processing…" state (after stop)
```

### 1.4 Setup Screen — Calibration Step

**Instruction displayed:** "Place the printed calibration sheet in the camera frame and tap Capture."

- "Capture Calibration Frame" button:
  - Captures current canvas frame as JPEG
  - POSTs to `/calibrate` with session code header
  - On success: show "✓ Scale set: 14.2 px/cm"
  - On failure: show "No marker detected — reposition sheet and retry"
- Calibration sheet is a **printable PDF served at `/calibration-sheet.pdf`** from the backend — a black circle exactly 9cm in diameter on A4. User prints it once.

### 1.5 Setup Screen — Color Sampling

Three-step tap sequence on live canvas:

| Step | Prompt |
|---|---|
| 1 | "Tap the small ball" |
| 2 | "Tap the sheet / background" |
| 3 | "Tap the big ball" |

**Per tap:**
- Extract 5×5px region centered on tap point
- Average RGB → convert to HSV client-side
- Show color swatch confirmation
- Allow re-tap to redo

**After all three sampled:**
- POST to `/setup` with `{ small_ball_hsv, sheet_hsv, big_ball_hsv }` + session code header
- Display accuracy score: "Detection accuracy: 87%"
- If score < 60%: yellow warning banner — "Low accuracy — try better lighting or re-sample"
- "Start Recording" button enabled regardless

### 1.6 Record Screen

**Detection overlay (always active when camera is open):**
- Every 200ms: capture frame → POST to `/detect_preview` → draw circle overlay
- Circle color: green (`score > 0.75`), yellow (`0.5–0.75`), red (`< 0.5`)
- Overlay updates independently from recording loop

**Recording loop:**
- `setInterval` at `FRAME_INTERVAL_MS = 66` (≈15fps)
- Each tick:
  - Capture canvas frame as JPEG (quality `0.85`)
  - Add to a **client-side send queue** (array)
  - Dequeue and POST to `/frame` asynchronously
  - On non-200 or network error: retry once after `50ms`
  - If retry fails: increment dropped-frame counter, discard frame
- Session timer: count up MM:SS
- Frame counter: "Frames: 42"
- Dropped counter: "Dropped: 0" (shown only if > 0)

**Client-side queue rationale:** decouples capture rate from network throughput. Camera always captures at 15fps; frames are sent as fast as the connection allows without blocking capture.

**Stop button:**
- Clear recording interval
- Flush remaining queue (POST all pending frames, wait for completion)
- POST to `/stop` with session code
- Transition to "Processing…" screen
- Poll `GET /status` every 1s
- On `status === "done"`: show "✓ Done — view results on laptop"

**Frame POST:**
- Endpoint: `POST /frame`
- Body: raw JPEG binary
- Headers:
  - `Content-Type: image/jpeg`
  - `X-Session-Code: A4K9XZ`
  - `X-Frame-Index: 42`

---

## Part 2 — Laptop Backend (FastAPI on Replit)

### 2.1 Tech Stack
- Python 3.11
- FastAPI + Uvicorn
- OpenCV (`cv2`)
- NumPy, SciPy
- `qrcode` library (for QR generation)
- `reportlab` (for calibration sheet PDF)
- JSON file storage (`./data/runs.json`)

### 2.2 Replit Configuration

**`.replit` file:**
```toml
[nix]
channel = "stable-23_11"

[deployment]
run = ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]

[[ports]]
localPort = 8080
externalPort = 443
```

**`replit.nix`:**
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

**`requirements.txt`:**
```
fastapi
uvicorn
opencv-python-headless
numpy
scipy
python-multipart
Pillow
qrcode[pil]
reportlab
```

**Note:** Use `opencv-python-headless` on Replit — the standard package requires a display which Replit's Linux environment does not have.

### 2.3 Directory Structure on Replit

```
/home/runner/ball-tracker-backend/
├── main.py
├── calibration.py
├── detection.py
├── curve_fitting.py
├── storage.py
├── session.py
├── requirements.txt
├── .replit
├── replit.nix
└── data/
    ├── runs.json          # persisted run data
    └── sessions/
        └── <session_uuid>/
            └── frames/    # temp; deleted after processing
```

### 2.4 Session State (`session.py`)

```python
# In-memory store (survives request lifecycle, resets on Repl restart)
sessions: dict[str, SessionState] = {}

class SessionState:
    session_id: str          # UUID
    session_code: str        # 6-char alphanumeric
    frames_dir: str          # ./data/sessions/<uuid>/frames/
    frame_count: int
    hsv_ranges: dict         # from /setup
    px_per_cm: float         # from /calibrate
    status: str              # "idle" | "recording" | "processing" | "done"
    progress: float          # 0.0 → 1.0 during processing
    result: dict | None      # populated on done
```

Session lookup: all endpoints accept `X-Session-Code` header → look up UUID → get state.

### 2.5 CORS Configuration

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://app.yourdomain.com", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 2.6 Endpoints

---

#### `POST /session/new`

**Purpose:** Create a new session, return code and QR.

**Request body:** none

**Processing:**
- Generate UUID (`session_id`)
- Generate 6-char code: `''.join(random.choices(string.ascii_uppercase + string.digits, k=6))`
- Initialize `SessionState`
- Create `./data/sessions/<uuid>/frames/` directory
- Generate QR code image (PNG, base64) encoding URL: `https://app.yourdomain.com/capture?session=<code>`

**Response:**
```json
{
  "session_code": "A4K9XZ",
  "session_id": "uuid-...",
  "qr_code_base64": "iVBORw0KGgo...",
  "capture_url": "https://app.yourdomain.com/capture?session=A4K9XZ"
}
```

---

#### `GET /calibration-sheet.pdf`

**Purpose:** Serve a printable calibration sheet.

**Processing (`calibration.py`):**
- Generate on-the-fly with `reportlab`:
  - A4 page
  - Black filled circle, diameter exactly 9cm, centered on page
  - Text below: "Ball Tracker Calibration Marker — Do not resize when printing"
- Return as PDF response

**Response:** `Content-Type: application/pdf`

---

#### `POST /calibrate`

**Purpose:** Detect calibration marker, compute px/cm ratio.

**Headers:** `X-Session-Code`

**Request body:** raw JPEG binary

**Processing (`calibration.py`):**
- Decode image with OpenCV
- Convert to grayscale → Gaussian blur → Canny edge detection
- Find contours → filter by:
  - Area > 5000px²
  - Circularity > 0.85: `circularity = 4π × area / perimeter²`
- Select largest qualifying contour
- Compute enclosing circle radius
- `px_per_cm = (radius_px × 2) / MARKER_DIAMETER_CM`
- Store in session state

**Constant:** `MARKER_DIAMETER_CM = 9.0`

**Response:**
```json
{ "ok": true, "px_per_cm": 14.2, "marker_radius_px": 63 }
```
or
```json
{ "ok": false, "error": "No circular marker detected — ensure sheet is fully visible and well-lit" }
```

---

#### `POST /setup`

**Purpose:** Store HSV ranges, estimate detection accuracy.

**Headers:** `X-Session-Code`

**Request body:**
```json
{
  "small_ball_hsv": { "h": 45, "s": 180, "v": 220 },
  "sheet_hsv":      { "h": 0,  "s": 0,   "v": 240 },
  "big_ball_hsv":   { "h": 20, "s": 200, "v": 180 }
}
```

**Processing (`calibration.py`):**

For each color, compute OpenCV HSV range:
```python
h_range = [max(0, h - 15),   min(179, h + 15)]
s_range = [max(0, s - 40),   min(255, s + 40)]
v_range = [max(0, v - 40),   min(255, v + 40)]
```

Accuracy estimation:
- Use last frame received via `/detect_preview` (cached in session state)
- Apply small ball HSV mask
- Find contours with circularity > 0.7
- `accuracy = min(100, int(best_score × 100))` where `best_score = circularity × hsv_fit`
- If no frame cached yet: return `accuracy: null` with message "Send a preview frame first"

**Response:**
```json
{
  "small_ball_range": { "h": [30, 60], "s": [140, 220], "v": [180, 255] },
  "big_ball_range":   { "h": [5, 35],  "s": [160, 240], "v": [140, 220] },
  "accuracy_score": 87,
  "accuracy_label": "Good"
}
```

Accuracy labels: `< 50` → "Poor", `50–74` → "Fair", `75–89` → "Good", `≥ 90` → "Excellent"

---

#### `POST /detect_preview`

**Purpose:** Single-frame detection for real-time phone overlay.

**Headers:** `X-Session-Code`

**Request body:** raw JPEG binary

**Processing (`detection.py`):**
- Cache frame in session state (overwrite previous; used by `/setup` for accuracy)
- Apply HSV mask for small ball range
- Find contours filtered by area > `MIN_CONTOUR_AREA_PX` and circularity > `MIN_CIRCULARITY`
- Score each: `score = circularity × hsv_fit`
- Return best candidate

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

---

#### `POST /frame`

**Purpose:** Receive and store a recording frame.

**Headers:**
- `X-Session-Code`
- `X-Frame-Index` (integer, for ordering)

**Request body:** raw JPEG binary

**Processing:**
- Look up session by code
- Save to `./data/sessions/<uuid>/frames/frame_<zero_padded_index>.jpg`
- Increment `session_state.frame_count`
- Set `session_state.status = "recording"` if not already

**Response:** `{ "ok": true, "frame_index": 42 }`

---

#### `GET /status`

**Purpose:** Poll processing progress from phone or laptop.

**Headers:** `X-Session-Code`

**Response (during processing):**
```json
{ "status": "processing", "progress": 0.45, "progress_label": "Fitting curves…" }
```

**Response (done):**
```json
{ "status": "done", "run_id": "run_003" }
```

**Response (recording):**
```json
{ "status": "recording", "frame_count": 87 }
```

---

#### `POST /stop`

**Purpose:** Trigger full processing pipeline.

**Headers:** `X-Session-Code`

**Request body:** `{}` (empty — session code in header is sufficient)

**Processing pipeline** (run in a background thread so HTTP response returns immediately):

---

**Step 1 — Validate** (`progress = 0.0`)
- Check `px_per_cm` is set; if not → error: "Calibration not completed"
- Check `hsv_ranges` is set; if not → error: "Color setup not completed"
- Check `frame_count >= MIN_VALID_FRAMES`; if not → error: `"Only {n} frames received — minimum {MIN_VALID_FRAMES} required"`

**Step 2 — Score all frames** (`progress = 0.1 → 0.4`)
- For each JPEG in `frames/` directory:
  - Decode with OpenCV
  - Apply small ball HSV mask
  - Find contours: filter area > `MIN_CONTOUR_AREA_PX`, circularity > `MIN_CIRCULARITY`
  - Best contour score: `circularity × hsv_fit`
  - Store: `(frame_index, score, centroid_x_px, centroid_y_px, radius_px)`
- Update progress proportionally per frame

**Step 3 — Select best frames** (`progress = 0.4`)
- Sort by score descending
- Filter: score > `MIN_DETECTION_SCORE`
- Take top `TARGET_FRAMES`
- If fewer than `MIN_VALID_FRAMES` pass threshold → error: `"Only {n} frames passed detection threshold"`

**Step 4 — Extract coordinates** (`progress = 0.5`)
- For each selected frame:
  - `origin_x = frame_width / 2`
  - `origin_y = frame_height / 2`
  - `x_cm = (centroid_x_px - origin_x) / px_per_cm`
  - `y_cm = (origin_y - centroid_y_px) / px_per_cm`  ← Y inverted: up = positive
- Result: array of `{ x_cm, y_cm, frame_index, score }`

**Step 5 — Detect big ball center** (`progress = 0.6`)
- Apply big ball HSV mask on each selected frame
- Same contour pipeline as Step 2
- Take centroid of highest-scoring detection across all frames
- Convert to cm same as Step 4
- Result: `{ big_ball_x_cm, big_ball_y_cm }`

**Step 6 — Curve fitting** (`progress = 0.7`)

Input: array of `(x_cm, y_cm)` points.

Fit three curves using `scipy` and `numpy`:

**Parabola:**
```python
coeffs = numpy.polyfit(x_array, y_array, deg=2)
# coeffs = [a, b, c] → y = ax² + bx + c
predicted = numpy.polyval(coeffs, x_array)
residual = numpy.mean((y_array - predicted) ** 2)
```

**Ellipse and Hyperbola** (algebraic implicit form):
```
Ax² + Bxy + Cy² + Dx + Ey + F = 0
Constraint: A + C = 1 (removes scale ambiguity)
```
Fit using `scipy.optimize.least_squares`. Classify result by discriminant:
- `B² - 4AC < 0` → Ellipse
- `B² - 4AC > 0` → Hyperbola

Convert implicit coefficients to canonical center form `(x-h)²/a² ± (y-k)²/b² = 1` for display.

Residual for conic: mean squared distance from each point to the fitted curve (radial distance approximation).

**Winner:** curve with lowest residual.

Round all display coefficients to 3 significant figures.

**Step 7 — Cleanup** (`progress = 0.9`)
- Delete `./data/sessions/<uuid>/frames/` directory

**Step 8 — Persist** (`progress = 1.0`)

Append to `./data/runs.json`:
```json
{
  "run_id": "run_003",
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
    "display": "y = 0.032x² − 0.11x + 2.4"
  }
}
```

Set `session_state.status = "done"`, `session_state.result = run_object`

**HTTP Response (immediate, before background processing completes):**
```json
{ "ok": true, "message": "Processing started" }
```

---

#### `GET /runs`

**Response:**
```json
{ "runs": [ ...array of all run objects... ] }
```

#### `GET /runs/{run_id}`

**Response:** Single run object.

---

### 2.7 Error Handling

All endpoints:
```python
try:
    ...
except Exception as e:
    return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})
```

Background pipeline errors (inside `/stop` thread):
- Set `session_state.status = "error"`
- Set `session_state.error_message = str(e)`
- `/status` endpoint returns: `{ "status": "error", "error": "message" }`

---

## Part 3 — Laptop Frontend PWA

### 3.1 Tech Stack
- Vanilla JS, HTML5 Canvas, CSS3
- No frameworks, no build step
- PWA manifest for installability
- `qrcode.js` (CDN) for QR display fallback if needed

### 3.2 Backend URL Configuration

Hardcode Replit backend URL as a constant at top of `app.js`:
```javascript
const API_BASE = "https://ball-tracker.yourusername.repl.co";
```

No user configuration needed.

### 3.3 Screens & Flow

```
App Load
  └── Home Screen
        ├── "New Session" button
        └── "View Past Runs" button
              └── New Session Flow
                    ├── Session Screen (QR + code display)
                    ├── Setup Status Screen (waiting for phone)
                    ├── Record Screen
                    ├── Processing Screen
                    └── Results Screen

Results Screen (also accessible from Home → "View Past Runs")
```

### 3.4 Session Screen

Triggered by "New Session":
- POST to `/session/new`
- Display:
  - Large session code: **`A4K9XZ`** (monospaced, prominent)
  - QR code image (render `qr_code_base64` as `<img>`)
  - Instruction: "Scan this QR with your phone to open the capture app"
  - Alternative: "Or go to app.yourdomain.com/capture and enter code manually"
- "Phone Connected" indicator: poll `GET /status` every 2s
  - When status transitions from `"idle"` to `"recording"` or phone sends first `/detect_preview`: show "✓ Phone connected"
  - Auto-advance to Setup Status Screen

### 3.5 Setup Status Screen

Displays live setup state from phone:
- "⏳ Waiting for calibration…" → "✓ Calibrated: 14.2 px/cm"
- "⏳ Waiting for color setup…" → "✓ Colors set — accuracy: 87% (Good)"
- Both done: "Ready to record" + "Go to Record Screen" button (auto-advance after 2s)

Poll `GET /status` every 1.5s to update state.

### 3.6 Record Screen

- Large "Recording in progress" indicator (animated red dot)
- Live stats pulled from `GET /status` every 1s:
  - Frame count: "Frames: 87"
  - Timer: "00:14"
- "Stop & Analyze" button:
  - Disabled for first 3 seconds of recording (prevents accidental immediate stop)
  - On click: POST `/stop` → navigate to Processing Screen

### 3.7 Processing Screen

- Centered progress bar (0–100%)
- Progress label text:
  - `0.0–0.1` → "Validating session…"
  - `0.1–0.4` → "Scoring frames…"
  - `0.4–0.6` → "Extracting coordinates…"
  - `0.6–0.7` → "Fitting curves…"
  - `0.7–0.9` → "Finalizing…"
  - `1.0` → "Done ✓"
- Poll `GET /status` every 500ms
- On `status === "error"`: show error message + "Try Again" button
- On `status === "done"`: auto-navigate to Results Screen after 800ms

### 3.8 Results Screen

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  [Sidebar]              │  [Grid Canvas]                 │
│                         │                                │
│  Run 1  ● [color] 👁    │                                │
│  Run 2  ● [color] 👁    │   (Desmos-style grid)         │
│  Run 3  ● [color] 👁    │                                │
│                         │                                │
│  [+ New Run]            │                                │
│                         │                                │
│  Toggle:                │                                │
│  ○ Dots ○ Curve ● Both  │                                │
│                         │                                │
│  Selected run equation: │                                │
│  y = 0.032x² − 0.11x   │                                │
│  + 2.4                  │                                │
│  Type: Parabola         │                                │
│                         │                                │
│  Residuals ▼            │                                │
│  Parabola:  0.023 ✓     │                                │
│  Ellipse:   0.18        │                                │
│  Hyperbola: 0.41        │                                │
└─────────────────────────────────────────────────────────┘
```

**Run List (sidebar):**
- Load all runs from `GET /runs` on screen mount
- Each run entry:
  - Run number + short timestamp (e.g. "Run 3 · 2:32 PM")
  - Color swatch: click to cycle through 8-color palette
  - Eye icon: toggle visibility (stored in `localStorage` per run_id)
  - Click row: select run → show equation below list
- "New Run" button: POST `/session/new` → navigates to Session Screen → on completion, refreshes run list and adds new run to grid

**8-color palette (assign in order, allow re-selection):**
```javascript
const RUN_COLORS = [
  "#4FC3F7", // sky blue
  "#FF8A65", // coral
  "#A5D6A7", // mint
  "#CE93D8", // lavender
  "#FFF176", // yellow
  "#EF9A9A", // rose
  "#80DEEA", // teal
  "#FFCC80", // peach
];
```

**Grid Canvas (`grid.js`):**

Setup:
```javascript
const GRID_RANGE_CM = 45;        // ±45cm on each axis
const GRID_MAJOR_STEP_CM = 10;
const GRID_MINOR_STEP_CM = 5;
const DOT_RADIUS_PX = 4;
const CURVE_SAMPLE_POINTS = 200;

// Canvas coordinate origin = center of canvas
// cm → px: px = (cm / GRID_RANGE_CM) * (canvas.width / 2) + canvas.width / 2
// Y inversion: canvas_y = canvas.height / 2 - (y_cm / GRID_RANGE_CM) * (canvas.height / 2)
```

Style:
- Background: `#0f1117`
- Minor grid lines: `rgba(255,255,255,0.05)`, 1px
- Major grid lines: `rgba(255,255,255,0.12)`, 1px
- Axes: `rgba(255,255,255,0.35)`, 2px
- Axis labels: `rgba(255,255,255,0.5)`, 11px monospaced font

Rendering per visible run:

**Dots mode:**
```javascript
ctx.fillStyle = run.color;
ctx.beginPath();
ctx.arc(canvas_x, canvas_y, DOT_RADIUS_PX, 0, Math.PI * 2);
ctx.fill();
```

**Curve mode:**
- Parabola: sample 200 x values from `-GRID_RANGE_CM` to `+GRID_RANGE_CM`; compute `y = ax² + bx + c`; draw polyline
- Ellipse: parametric — `x = h + a×cos(t)`, `y = k + b×sin(t)`, t from 0 to 2π, 200 steps
- Hyperbola: parametric — two branches, `x = h ± a×cosh(t)`, `y = k + b×sinh(t)`, clip to grid range

**Big ball center marker:**
- White `✕` shape (two 10px lines crossed), drawn on top of all run layers
- Shared across all runs (same physical object)

**Interactivity:**
- Scroll to zoom (min `0.5×`, max `4×`); transform canvas scale
- Click + drag to pan
- Hover over dot: show tooltip `(x: 12.4cm, y: 8.1cm)`

---

## Part 4 — Constants & Configuration

### Backend (`detection.py`)
```python
MIN_CONTOUR_AREA_PX = 100
MIN_CIRCULARITY = 0.70
MIN_DETECTION_SCORE = 0.40
TARGET_FRAMES = 25
MIN_VALID_FRAMES = 10
MARKER_DIAMETER_CM = 9.0
HSV_H_TOLERANCE = 15
HSV_S_TOLERANCE = 40
HSV_V_TOLERANCE = 40
```

### Phone PWA (`app.js`)
```javascript
const FPS = 15;
const FRAME_INTERVAL_MS = Math.round(1000 / FPS);   // 67ms
const JPEG_QUALITY = 0.85;
const RETRY_DELAY_MS = 50;
const PREVIEW_INTERVAL_MS = 200;
const API_BASE = "https://ball-tracker.yourusername.repl.co";
```

### Laptop PWA (`grid.js`, `app.js`)
```javascript
const API_BASE = "https://ball-tracker.yourusername.repl.co";
const GRID_RANGE_CM = 45;
const GRID_MAJOR_STEP_CM = 10;
const GRID_MINOR_STEP_CM = 5;
const DOT_RADIUS_PX = 4;
const CURVE_SAMPLE_POINTS = 200;
const STATUS_POLL_INTERVAL_MS = 1000;
const PROCESSING_POLL_INTERVAL_MS = 500;
const RUN_COLORS = ["#4FC3F7","#FF8A65","#A5D6A7","#CE93D8","#FFF176","#EF9A9A","#80DEEA","#FFCC80"];
```

---

## Part 5 — Data Flow Summary

```
Laptop PWA
  └─ POST /session/new ──────────────► Generate code + QR
                                              │
  ◄── { code: "A4K9XZ", qr: "..." } ─────────┘
  └─ Display QR on screen

Phone PWA (scans QR)
  └─ Opens capture?session=A4K9XZ
  └─ POST /calibrate ────────────────► Compute px_per_cm
  └─ POST /setup ────────────────────► Compute HSV ranges + accuracy
  └─ POST /detect_preview (loop) ────► Real-time detection overlay
  └─ POST /frame × N ────────────────► Store JPEGs to disk
  └─ POST /stop ─────────────────────► Background pipeline:
                                         Score frames
                                         Select best 25
                                         Extract cm coords
                                         Detect big ball center
                                         Fit parabola/ellipse/hyperbola
                                         Pick winner
                                         Delete raw frames
                                         Persist run JSON
                                              │
Laptop PWA                                    │
  └─ GET /status (polling) ◄─────────────────┘
  └─ GET /runs ──────────────────────► Load all runs
  └─ Render grid canvas
       ├── dot plot per run
       ├── curve overlay
       └── equation + residuals
```

---

## Part 6 — Replit Deployment Steps

1. Create a new Replit project — select **Python** template
2. Paste all backend files into the Repl editor
3. Add `.replit` and `replit.nix` as shown in 2.2
4. Click **Run** — Replit installs dependencies and starts Uvicorn
5. Copy the Replit HTTPS URL (e.g. `https://ball-tracker.yourusername.repl.co`)
6. Paste this URL as `API_BASE` in both PWAs before deploying to Vercel
7. Upgrade to **Reserved VM** in Replit settings — ensures the backend stays alive between sessions
8. In Replit **Secrets**, add any environment variables if needed (none required for basic setup)
9. Enable **Always On** toggle in the Repl settings panel

**Custom domain on Replit backend (optional):**
- Go to Replit project → Settings → Custom Domain
- Add `api.yourdomain.com`
- Update DNS CNAME record to point to Replit
- Update `API_BASE` in both PWAs to `https://api.yourdomain.com`

---

## Part 7 — Implementation Notes for AI Agent

1. **Build order:** Backend endpoints → mock frame test script → phone PWA → laptop PWA. Never build UI before the API it depends on is tested.

2. **Test the pipeline independently first.** Write `test_pipeline.py` that generates 60 synthetic JPEG frames (white background, orange circle moving in a parabola), POSTs them to `/frame`, calls `/stop`, and asserts the winning curve is `"parabola"` with low residual.

3. **OpenCV on Replit requires `opencv-python-headless`** — the standard package will fail silently or error on import due to missing display libraries.

4. **HSV color space in OpenCV:** H is 0–179 (not 0–360), S and V are 0–255. Browser canvas gives RGB 0–255. Convert carefully:
   ```python
   # Standard RGB → HSV for OpenCV
   h_ocv = h_degrees / 2   # 360° → 0–179
   ```

5. **Y-axis inversion.** Browser canvas Y increases downward. Real-world Y increases upward. Always apply: `y_cm = (origin_y_px - centroid_y_px) / px_per_cm`

6. **Ellipse/hyperbola fitting** is numerically sensitive. Use the algebraic form `Ax² + Bxy + Cy² + Dx + Ey + F = 0` with SVD (via `numpy.linalg.svd`) rather than `scipy.optimize` — it's more stable and doesn't need initial parameter guesses.

7. **Background thread for `/stop`:** FastAPI handles this cleanly with `BackgroundTasks`:
   ```python
   @app.post("/stop")
   async def stop(background_tasks: BackgroundTasks, ...):
       background_tasks.add_task(run_pipeline, session_code)
       return {"ok": True, "message": "Processing started"}
   ```

8. **`runs.json` file locking.** If two sessions finish simultaneously, concurrent writes to `runs.json` will corrupt data. Use Python's `threading.Lock()` around all read/write operations on this file.

9. **QR code on laptop screen.** Render the `qr_code_base64` string directly as `<img src="data:image/png;base64,{qr_code_base64}">` — no client-side QR library needed.

10. **PWA `getUserMedia` requires HTTPS.** Vercel provides this automatically. Local development: use `npx serve` with a self-signed cert, or use `ngrok http 3000` for the frontend during dev.

11. **Replit file persistence.** Replit's file system persists across restarts on Reserved VM. `./data/runs.json` and session directories will survive Repl restarts. In-memory `session_state` dict will not — this only matters if the Repl restarts mid-recording (rare, acceptable failure mode for v1).