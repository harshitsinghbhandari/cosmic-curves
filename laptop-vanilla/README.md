# Ball Tracker - Laptop Control & Results App

Progressive Web App for controlling experiment sessions and visualizing trajectory results. Part of the CosmosCurves Ball Trajectory Tracker system.

## Features

- **Session Management**: Create new sessions with QR codes
- **Real-time Status**: Live updates during phone setup and recording
- **Interactive Visualization**: Zoom and pan trajectory plots
- **Curve Fitting Results**: View parabola, ellipse, hyperbola fits
- **Run History**: Browse and compare past experiments
- **Color Customization**: Change run colors for comparison
- **Export-Friendly**: View equations and residuals

## Quick Start

### Prerequisites

- Modern desktop browser (Chrome, Firefox, Safari, Edge)
- HTTPS connection (for PWA features)
- Backend server running and accessible

### Setup

1. **Configure Backend URL**

   Edit `app.js` and update the API base URL:
   ```javascript
   const API_BASE = "https://your-backend-url.com";
   ```

2. **Serve the App**

   ```bash
   # Using Python
   python -m http.server 3000

   # Using Node.js
   npx serve .
   ```

3. **Deploy to Production**

   ```bash
   # Vercel
   vercel deploy

   # Netlify
   netlify deploy --prod
   ```

## Usage

### 1. Create New Session

1. Open app in browser
2. Click **"New Session"**
3. QR code and 6-character code appear
4. Scan QR with phone or enter code manually

### 2. Monitor Setup

Watch real-time status updates:
- "Waiting for calibration..."
- "Calibrated: XX px/cm"
- "Colors set — accuracy: XX%"
- "Ready to record"

### 3. Recording

- See live frame count during recording
- Timer shows recording duration
- "Stop & Analyze" button available after 3 seconds

### 4. Processing

Watch progress bar:
- Validating session...
- Scoring frames...
- Extracting coordinates...
- Fitting curves...
- Finalizing...

### 5. Results

Explore the trajectory visualization:
- **Scroll**: Zoom in/out
- **Drag**: Pan around
- **Hover**: See coordinates
- **Eye icon**: Toggle visibility
- **Color swatch**: Cycle colors

## Screens

### Home Screen
- "New Session" button
- "View Past Runs" button

### Session Screen
- QR code display
- Session code (6 characters)
- Connection status indicator

### Setup Status Screen
- Calibration status
- Color setup status
- "Go to Record Screen" button

### Record Screen
- Recording indicator (animated)
- Frame count
- Timer
- Stop & Analyze button

### Processing Screen
- Progress bar (0-100%)
- Progress label
- Error display (if any)

### Results Screen
- Run list sidebar
- Visualization controls
- Coordinate grid canvas
- Equation display
- Residuals panel

## Configuration

### Constants (app.js)

```javascript
const API_BASE = "https://your-backend-url.com";
const STATUS_POLL_INTERVAL_MS = 1500;      // Status polling rate
const PROCESSING_POLL_INTERVAL_MS = 500;  // Processing progress rate
```

### Grid Settings (grid.js)

```javascript
const GRID_RANGE_CM = 45;                 // Visible range (±cm)
const GRID_MAJOR_STEP_CM = 10;            // Major grid lines
const GRID_MINOR_STEP_CM = 5;             // Minor grid lines
const DOT_RADIUS_PX = 4;                  // Data point size
const CURVE_SAMPLE_POINTS = 200;          // Curve smoothness
const RUN_COLORS = [...];                  // 8-color palette
```

## File Structure

```
laptop-pwa/
├── index.html          # Main HTML structure
├── app.js              # Session management and API calls
├── grid.js             # Canvas visualization class
├── style.css           # Desktop styling
├── manifest.json       # PWA manifest
└── sw.js               # Service worker
```

## Grid Visualization

### Coordinate System

- Origin: Center of canvas
- X-axis: Right = positive
- Y-axis: Up = positive (inverted from screen)
- Grid lines: Major (10cm), Minor (5cm)

### Rendering Modes

| Mode | Description |
|------|-------------|
| Dots | Show trajectory points only |
| Curve | Show fitted curve only |
| Both | Show dots and curve (default) |

### Zoom & Pan

```javascript
// Zoom limits
const MIN_SCALE = 0.5;
const MAX_SCALE = 4.0;

// Mouse wheel zoom
canvas.addEventListener('wheel', (e) => { ... });

// Drag to pan
canvas.addEventListener('mousedown', (e) => { ... });
```

### Big Ball Center Marker

Rendered as white ✕:
```javascript
ctx.strokeStyle = 'white';
ctx.lineWidth = 2;
ctx.moveTo(cx - 8, cy - 8);
ctx.lineTo(cx + 8, cy + 8);
ctx.moveTo(cx + 8, cy - 8);
ctx.lineTo(cx - 8, cy + 8);
```

## Run Colors

Default 8-color palette:
```javascript
const RUN_COLORS = [
  "#4FC3F7",  // Sky blue
  "#FF8A65",  // Coral
  "#A5D6A7",  // Mint
  "#CE93D8",  // Lavender
  "#FFF176",  // Yellow
  "#EF9A9A",  // Rose
  "#80DEEA",  // Teal
  "#FFCC80"   // Peach
];
```

Colors are persisted in localStorage per run ID.

## Curve Equations

### Parabola

```
y = ax² + bx + c

Coefficients: { a, b, c }
```

### Ellipse/Hyperbola

```
Ax² + Bxy + Cy² + Dx + Ey + F = 0

Classification by discriminant:
- B² - 4AC < 0: Ellipse
- B² - 4AC > 0: Hyperbola
```

## API Integration

### Session Creation

```javascript
const res = await api('/session/new', 'POST');
sessionCode = res.session_code;
// Display QR code from res.qr_code_base64
```

### Status Polling

```javascript
setInterval(async () => {
    const status = await api('/status');
    // Update UI based on status.status
}, STATUS_POLL_INTERVAL_MS);
```

### Load Runs

```javascript
const res = await api('/runs');
const runs = res.runs.reverse(); // Most recent first
```

## Local Storage

| Key | Value | Purpose |
|-----|-------|---------|
| `activeSession` | Session code | Resume previous session |
| `color_{run_id}` | Hex color | Persist run color |
| `vis_{run_id}` | `true/false` | Persist visibility |

## Styling

### Theme

```css
/* Dark theme */
--bg-primary: #0f1117;
--bg-secondary: #161921;
--text-primary: #ffffff;
--text-secondary: rgba(255,255,255,0.5);
--accent-primary: #4FC3F7;
--accent-secondary: #A5D6A7;
```

### Components

- **Buttons**: Primary (cyan), Secondary (gray), Danger (rose)
- **Inputs**: Dark background, white text
- **Cards/Sidebar**: Slightly lighter background
- **Grid**: Dark canvas with white grid lines

## Troubleshooting

### "Failed to create session"

1. Check backend is running
2. Verify `API_BASE` URL is correct
3. Check CORS configuration
4. Try clearing browser cache

### QR Code Not Displaying

1. Backend might not have `qrcode` library
2. Check browser console for errors
3. Verify base64 image is valid

### Grid Not Rendering

1. Check canvas element exists
2. Verify Grid class initialized
3. Check runs data structure
4. Clear localStorage if corrupted

### Runs Not Loading

1. Check backend `/runs` endpoint
2. Verify `runs.json` exists on backend
3. Check browser console for errors

### Zoom/Pan Not Working

1. Canvas needs focus
2. Check event listeners attached
3. Verify mouse events not blocked

## Browser Compatibility

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome | Full | Recommended |
| Firefox | Full | Good performance |
| Safari | Full | Good performance |
| Edge | Full | Chromium-based |
| IE11 | None | Not supported |

## PWA Installation

### Desktop Chrome

1. Click install icon in address bar
2. Or use menu → "Install Ball Tracker"

### Desktop Safari

1. Not supported (use Chrome/Firefox)

## Development

### Local Development

```bash
# Serve files
npx serve .

# With HTTPS for full PWA support
npx serve . --ssl-cert cert.pem --ssl-key key.pem
```

### Debugging

Enable console logging:
```javascript
const DEBUG = true;
if (DEBUG) console.log('Status:', status);
```

## Accessibility

- Keyboard navigation supported
- High contrast colors
- Readable font sizes (14px minimum)
- Tooltips for data points

## License

MIT License - See main project README for details.