# Ball Tracker - Phone Capture App

Progressive Web App for capturing ball trajectories using the phone's rear camera. Part of the CosmosCurves Ball Trajectory Tracker system.

## Features

- **Camera Capture**: Uses rear camera for overhead ball tracking
- **QR Code Linking**: Scan QR or enter session code manually
- **Calibration**: Capture calibration marker for accurate measurements
- **Color Sampling**: Tap-to-sample HSV colors for ball detection
- **Real-time Detection Overlay**: See ball position during setup
- **Frame Streaming**: Sends frames at 15 FPS to backend
- **Offline Support**: Service worker for basic offline capability
- **PWA Installable**: Add to home screen for native-like experience

## Quick Start

### Prerequisites

- Modern mobile browser (Chrome, Safari, Firefox)
- HTTPS connection required for camera access
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

   Deploy to Vercel, Netlify, or any static hosting:
   ```bash
   # Vercel
   vercel deploy

   # Netlify
   netlify deploy --prod
   ```

## Usage

### 1. Join a Session

**Option A: Scan QR Code**
- Open phone camera app
- Point at QR code displayed on laptop
- Tap notification to open link

**Option B: Manual Entry**
- Open app in browser
- Enter 6-character session code from laptop
- Press "Join"

### 2. Camera Setup

- Allow camera permissions when prompted
- Position phone overhead with camera facing down
- Ensure good lighting

### 3. Calibration

1. Print calibration sheet (9cm circle) from backend
2. Place sheet in camera view
3. Tap "Capture Marker"
4. Wait for "✓ Scale set: XX px/cm"

### 4. Color Sampling

Follow the prompts in order:
1. **"Tap the small ball"** - The ball being thrown
2. **"Tap the sheet/background"** - The surface area
3. **"Tap the big ball"** - Stationary reference ball

**Tips:**
- Tap directly on the colored area
- Ensure distinct color differences
- Re-tap if accuracy score is low (<60%)

### 5. Recording

1. Position phone to capture experiment area
2. Press red **RECORD** button
3. Perform experiment (throw ball, etc.)
4. Press **RECORD** button again to stop
5. Wait for "Processing..." screen
6. View results on laptop

## Configuration

### Constants (app.js)

```javascript
const FPS = 15;                           // Recording frame rate
const FRAME_INTERVAL_MS = 67;             // Milliseconds between frames
const JPEG_QUALITY = 0.85;                // Image compression (0-1)
const PREVIEW_INTERVAL_MS = 200;          // Detection overlay refresh
const API_BASE = "https://your-backend";   // Backend URL
```

### Frame Rate

Higher FPS = smoother trajectory but more network load:
- 15 FPS is recommended for most use cases
- Lower to 10 FPS for slower connections
- Network queue prevents frame drops

## File Structure

```
phone-pwa/
├── index.html          # Main HTML structure
├── app.js              # Camera capture and streaming logic
├── style.css           # Mobile-optimized styling
├── manifest.json       # PWA manifest for installability
└── sw.js               # Service worker for offline support
```

## Screens

### Join Screen
- Session code input field
- Join button
- Error display

### Camera Container
- Full-screen video preview
- Canvas overlay for detection visualization

### Setup UI
- Calibration capture button
- Color sampling prompts
- Accuracy score display
- "Go to Record" button

### Record UI
- Timer display (MM:SS)
- Frame counter
- Dropped frames indicator
- Record/Stop button

### Processing UI
- Processing message
- Wait for laptop results

## API Communication

### Request Format

All API calls include session code header:
```javascript
fetch(`${API_BASE}/endpoint`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-Session-Code': sessionCode
    },
    body: JSON.stringify(data)
});
```

### Frame Upload

Frames are uploaded as raw JPEG binary:
```javascript
const blob = captureJPEG(); // Canvas to JPEG Blob
await fetch(`${API_BASE}/frame`, {
    method: 'POST',
    headers: {
        'Content-Type': 'image/jpeg',
        'X-Session-Code': sessionCode,
        'X-Frame-Index': frameIndex.toString()
    },
    body: blob
});
```

## Detection Overlay

The overlay draws a circle around detected balls:

```javascript
// Green: High confidence (score > 0.75)
overlayCtx.strokeStyle = '#4CAF50';

// Yellow: Medium confidence (0.5 < score < 0.75)
overlayCtx.strokeStyle = '#FFEB3B';

// Red: Low confidence (score < 0.5)
overlayCtx.strokeStyle = '#F44336';
```

## Performance Optimization

### Frame Queue

Frames are queued and sent asynchronously:
```javascript
sendQueue.push({ blob: frameBlob, index: frameCount });
processQueue(); // Async send
```

This prevents:
- Camera frame drops
- UI blocking during network operations

### Memory Management

- Canvas is reused for frame capture
- JPEG compression reduces payload size
- Old frames are garbage collected after send

## Troubleshooting

### Camera Not Working

1. **Ensure HTTPS**: Camera requires secure context
2. **Check Permissions**: Allow camera access in browser settings
3. **Try Different Browser**: Chrome recommended for Android, Safari for iOS

### "No circular marker detected"

1. Ensure calibration sheet is fully visible
2. Improve lighting (avoid shadows)
3. Hold phone steady
4. Check marker is 9cm diameter (not resized)

### Low Accuracy Score

1. Re-sample colors with better lighting
2. Ensure ball colors are distinct from background
3. Avoid similar colors between small and big ball
4. Clean camera lens

### Connection Errors

1. Check backend URL is correct
2. Verify backend is running
3. Check network connectivity
4. Ensure CORS is configured on backend

### Frame Drops

1. Lower FPS setting
2. Reduce JPEG quality
3. Move closer to WiFi router
4. Close other network-intensive apps

## Browser Compatibility

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome Android | Full | Recommended |
| Safari iOS | Full | Recommended |
| Firefox Android | Full | Good performance |
| Samsung Internet | Full | Based on Chrome |
| Chrome iOS | Partial | May have camera issues |

## PWA Installation

### Android Chrome

1. Open app in Chrome
2. Tap menu (three dots)
3. Tap "Add to Home screen"
4. Tap "Install"

### iOS Safari

1. Open app in Safari
2. Tap Share button
3. Tap "Add to Home Screen"
4. Tap "Add"

## Security Considerations

- Session codes are random 6-character strings
- No authentication required (designed for local/trusted networks)
- Frame data is transmitted over HTTPS
- No sensitive data stored locally

## Development

### Local Development

```bash
# Serve with HTTPS for camera access
npx serve . --ssl-cert cert.pem --ssl-key key.pem

# Or use ngrok for public HTTPS
ngrok http 3000
```

### Debugging

Enable verbose logging:
```javascript
// In app.js, add:
const DEBUG = true;
if (DEBUG) console.log('Frame sent:', frameIndex);
```

## License

MIT License - See main project README for details.