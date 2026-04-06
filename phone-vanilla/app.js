const API_BASE = CONFIG.API_BASE;
const FPS = 15;
const FRAME_INTERVAL_MS = Math.round(1000 / FPS);
const JPEG_QUALITY = 0.85;
const PREVIEW_INTERVAL_MS = 200;

let sessionCode = null;
let video = document.getElementById('videoElement');
let overlayCanvas = document.getElementById('overlayCanvas');
let overlayCtx = overlayCanvas.getContext('2d');
let captureCanvas = document.getElementById('captureCanvas');
let captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });

let isRecording = false;
let recordInterval = null;
let previewInterval = null;
let frameCount = 0;
let droppedFrames = 0;
let startTime = 0;

let sendQueue = [];
let isSending = false;

let setupStage = 0; 
let sampledColors = [];
const colorPrompts = ["Tap the small ball", "Tap the sheet/background", "Tap the big ball"];

const params = new URLSearchParams(window.location.search);
if (params.has('session')) {
    sessionCode = params.get('session').toUpperCase();
    startCameraFlow();
} else {
    document.getElementById('join-screen').classList.add('active');
}

document.getElementById('btn-join').addEventListener('click', () => {
    let code = document.getElementById('session-input').value.trim().toUpperCase();
    if (code.length === 6) {
        sessionCode = code;
        startCameraFlow();
    } else {
        document.getElementById('join-error').textContent = "Invalid code length";
    }
});

async function api(path, method="GET", bodyObj=null, rawBody=null, extraHeaders={}) {
    const headers = { 'X-Session-Code': sessionCode, ...extraHeaders };
    if (bodyObj) headers['Content-Type'] = 'application/json';
    
    const options = { method, headers };
    if (bodyObj) options.body = JSON.stringify(bodyObj);
    if (rawBody) options.body = rawBody;
    
    const r = await fetch(`${API_BASE}${path}`, options);
    if (!r.ok) {
        let err;
        try { err = (await r.json()).error; } catch(e) { err = r.statusText; }
        throw new Error(err);
    }
    return await r.json();
}

async function startCameraFlow() {
    document.getElementById('join-screen').classList.remove('active');
    document.getElementById('camera-container').style.display = 'block';
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment', width: { ideal: 800 }, height: { ideal: 600 } }
        });
        video.srcObject = stream;
        
        video.onloadedmetadata = () => {
            overlayCanvas.width = video.videoWidth;
            overlayCanvas.height = video.videoHeight;
            captureCanvas.width = video.videoWidth;
            captureCanvas.height = video.videoHeight;
            startCalibrationPhase();
        };
    } catch(e) {
        document.getElementById('setup-prompt').textContent = "Camera Error: " + e.message;
    }
}

function captureJPEG() {
    captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
    const dataUrl = captureCanvas.toDataURL('image/jpeg', JPEG_QUALITY);
    const bytes = atob(dataUrl.split(',')[1]);
    const ab = new ArrayBuffer(bytes.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < bytes.length; i++) ia[i] = bytes.charCodeAt(i);
    return new Blob([ab], { type: 'image/jpeg' });
}

function startCalibrationPhase() {
    document.getElementById('setup-prompt').textContent = "Place calibration sheet and tap Capture";
    document.getElementById('setup-calib-step').style.display = 'block';
}

document.getElementById('btn-capture-calib').addEventListener('click', async () => {
    try {
        document.getElementById('setup-prompt').textContent = "Calibrating...";
        const blob = captureJPEG();
        const res = await api('/calibrate', 'POST', null, blob, {'Content-Type': 'image/jpeg'});
        document.getElementById('setup-calib-step').style.display = 'none';
        document.getElementById('setup-result').textContent = `✓ Scale set: ${res.px_per_cm.toFixed(1)} px/cm`;
        setTimeout(startColorPhase, 1500);
    } catch(e) {
        document.getElementById('setup-error').textContent = e.message;
        document.getElementById('setup-prompt').textContent = "Retry setup";
    }
});

function startColorPhase() {
    document.getElementById('setup-result').textContent = "";
    document.getElementById('setup-error').textContent = "";
    document.getElementById('setup-calib-step').style.display = 'none';
    document.getElementById('setup-color-step').style.display = 'block';
    document.getElementById('setup-prompt').textContent = colorPrompts[0];
    
    overlayCanvas.addEventListener('pointerdown', handleColorTap);
    startPreviewLoop(); 
}

function handleColorTap(e) {
    if (setupStage >= 3) return;
    
    const rect = overlayCanvas.getBoundingClientRect();
    const scaleX = overlayCanvas.width / rect.width;
    const scaleY = overlayCanvas.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
    const imgData = captureCtx.getImageData(Math.max(0, x-2), Math.max(0, y-2), 5, 5).data;
    
    let r=0, g=0, b=0;
    for(let i=0; i<imgData.length; i+=4) {
        r+=imgData[i]; g+=imgData[i+1]; b+=imgData[i+2];
    }
    const count = imgData.length/4;
    r/=count; g/=count; b/=count;
    
    r/=255; g/=255; b/=255;
    let max = Math.max(r,g,b), min = Math.min(r,g,b);
    let h, s, v = max;
    let d = max - min;
    s = max === 0 ? 0 : d/max;
    if (max === min) {
        h = 0;
    } else {
        switch(max) {
            case r: h = (g - b)/d + (g < b ? 6 : 0); break;
            case g: h = (b - r)/d + 2; break;
            case b: h = (r - g)/d + 4; break;
        }
        h /= 6;
    }
    
    sampledColors.push({
        h: Math.round(h * 360),
        s: Math.round(s * 255),
        v: Math.round(v * 255)
    });
    
    setupStage++;
    document.getElementById('color-samples').textContent = `${setupStage}/3`;
    
    if (setupStage < 3) {
        document.getElementById('setup-prompt').textContent = colorPrompts[setupStage];
    } else {
        overlayCanvas.removeEventListener('pointerdown', handleColorTap);
        submitColors();
    }
}

async function submitColors() {
    document.getElementById('setup-prompt').textContent = "Analyzing colors...";
    try {
        const payload = {
            small_ball_hsv: sampledColors[0],
            sheet_hsv: sampledColors[1],
            big_ball_hsv: sampledColors[2]
        };
        const res = await api('/setup', 'POST', payload);
        
        document.getElementById('setup-color-step').style.display = 'none';
        document.getElementById('setup-result').textContent = `Accuracy: ${res.accuracy_score}% (${res.accuracy_label})`;
        if (res.accuracy_score < 60) {
            document.getElementById('setup-error').textContent = "Low accuracy. Refresh to try again.";
        }
        document.getElementById('btn-start-record').style.display = 'block';
    } catch(e) {
        document.getElementById('setup-error').textContent = e.message;
    }
}

document.getElementById('btn-start-record').addEventListener('click', () => {
    document.getElementById('setup-ui').style.display = 'none';
    document.getElementById('record-ui').style.display = 'flex';
});

function startPreviewLoop() {
    previewInterval = setInterval(async () => {
        if (isRecording) return; 
        
        try {
            const blob = captureJPEG();
            const res = await api('/detect_preview', 'POST', null, blob, {'Content-Type': 'image/jpeg'});
            
            overlayCtx.clearRect(0,0, overlayCanvas.width, overlayCanvas.height);
            if (res.detected) {
                overlayCtx.beginPath();
                overlayCtx.arc(res.x_px, res.y_px, res.radius_px, 0, Math.PI*2);
                overlayCtx.lineWidth = 4;
                if (res.score > 0.75) overlayCtx.strokeStyle = '#4CAF50';
                else if (res.score > 0.5) overlayCtx.strokeStyle = '#FFEB3B';
                else overlayCtx.strokeStyle = '#F44336';
                overlayCtx.stroke();
            }
        } catch(e) { }
    }, PREVIEW_INTERVAL_MS);
}

async function processQueue() {
    if (isSending || sendQueue.length === 0) return;
    isSending = true;
    
    while (sendQueue.length > 0) {
        const item = sendQueue[0];
        try {
            await api('/frame', 'POST', null, item.blob, {
                'Content-Type': 'image/jpeg',
                'X-Frame-Index': item.index.toString()
            });
            sendQueue.shift(); 
        } catch(e) {
            droppedFrames++;
            document.getElementById('rec-dropped').style.display = 'block';
            document.getElementById('rec-dropped').textContent = `Dropped: ${droppedFrames}`;
            sendQueue.shift(); 
        }
    }
    isSending = false;
}

document.getElementById('btn-record-action').addEventListener('click', async () => {
    const btn = document.getElementById('btn-record-action');
    if (!isRecording) {
        isRecording = true;
        btn.classList.add('recording');
        
        if(previewInterval) clearInterval(previewInterval);
        overlayCtx.clearRect(0,0, overlayCanvas.width, overlayCanvas.height);
        
        frameCount = 0;
        droppedFrames = 0;
        startTime = Date.now();
        sendQueue = [];
        
        recordInterval = setInterval(() => {
            const blob = captureJPEG();
            sendQueue.push({ blob: blob, index: frameCount });
            frameCount++;
            
            document.getElementById('rec-frames').textContent = `Frames: ${frameCount}`;
            
            const diff = Math.floor((Date.now() - startTime)/1000);
            const m = String(Math.floor(diff/60)).padStart(2,'0');
            const s = String(diff%60).padStart(2,'0');
            document.getElementById('rec-time').textContent = `${m}:${s}`;
            
            processQueue();
        }, FRAME_INTERVAL_MS);
    } else {
        clearInterval(recordInterval);
        btn.classList.remove('recording');
        document.getElementById('record-ui').style.display = 'none';
        document.getElementById('processing-ui').style.display = 'flex';
        
        while(sendQueue.length > 0 || isSending) {
            await new Promise(r => setTimeout(r, 100));
        }
        
        try {
            await api('/stop', 'POST', {});
        } catch (e) {
            alert(e.message);
        }
    }
});

// Update for Offline support via Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker registered.'))
            .catch(err => console.log('Service Worker registration failed: ', err));
    });
}
