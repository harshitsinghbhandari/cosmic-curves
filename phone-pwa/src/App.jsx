import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CONFIG } from './config';
import './index.css';

const API_BASE = CONFIG.API_BASE;
const FPS = 15;
const FRAME_INTERVAL_MS = Math.round(1000 / FPS);
const JPEG_QUALITY = 0.85;
const PREVIEW_INTERVAL_MS = 200;
const colorPrompts = ["Tap the small ball", "Tap the sheet/background", "Tap the big ball"];

function App() {
  const [screen, setScreen] = useState('join');
  const [sessionCode, setSessionCode] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [error, setError] = useState('');
  const [setupPrompt, setSetupPrompt] = useState('Initializing camera...');
  const [setupResult, setSetupResult] = useState('');
  const [setupStage, setSetupStage] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [droppedFrames, setDroppedFrames] = useState(0);
  const [timer, setTimer] = useState('00:00');
  const [sampledColors, setSampledColors] = useState([]);
  const [accuracy, setAccuracy] = useState(null);

  const videoRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const recordIntervalRef = useRef(null);
  const previewIntervalRef = useRef(null);
  const startTimeRef = useRef(0);
  const sendQueueRef = useRef([]);
  const isSendingRef = useRef(false);

  // Parse URL for session code
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('session')) {
      const code = params.get('session').toUpperCase();
      setSessionCode(code);
      setScreen('camera');
    }
  }, []);

  const api = useCallback(async (path, method = "GET", bodyObj = null, rawBody = null, extraHeaders = {}) => {
    if (!sessionCode) return;
    const headers = { 'X-Session-Code': sessionCode, ...extraHeaders };
    if (bodyObj) headers['Content-Type'] = 'application/json';

    const options = { method, headers };
    if (bodyObj) options.body = JSON.stringify(bodyObj);
    if (rawBody) options.body = rawBody;

    const r = await fetch(`${API_BASE}${path}`, options);
    if (!r.ok) {
      let err;
      try { err = (await r.json()).error; } catch (e) { err = r.statusText; }
      throw new Error(err);
    }
    return await r.json();
  }, [sessionCode]);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 800 }, height: { ideal: 600 } }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
           const { videoWidth, videoHeight } = videoRef.current;
           overlayCanvasRef.current.width = videoWidth;
           overlayCanvasRef.current.height = videoHeight;
           captureCanvasRef.current.width = videoWidth;
           captureCanvasRef.current.height = videoHeight;
           setSetupPrompt('Place calibration sheet and tap Capture');
           setScreen('camera');
        };
      }
    } catch (e) {
      setSetupPrompt("Camera Error: " + e.message);
    }
  }, []);

  useEffect(() => {
    if (screen === 'camera') {
      startCamera();
    }
  }, [screen, startCamera]);

  const captureJPEG = () => {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    const bytes = atob(dataUrl.split(',')[1]);
    const ab = new ArrayBuffer(bytes.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < bytes.length; i++) ia[i] = bytes.charCodeAt(i);
    return new Blob([ab], { type: 'image/jpeg' });
  };

  const handleCalibrate = async () => {
    try {
      setSetupPrompt("Calibrating...");
      const blob = captureJPEG();
      const res = await api('/calibrate', 'POST', null, blob, { 'Content-Type': 'image/jpeg' });
      setSetupResult(`✓ Scale set: ${res.px_per_cm.toFixed(1)} px/cm`);
      setTimeout(() => {
        setSetupStage(1); // Moving to color setup
        setSetupPrompt(colorPrompts[0]);
        startPreviewLoop();
      }, 1500);
    } catch (e) {
      setError(e.message);
      setSetupPrompt("Retry setup");
    }
  };

  const startPreviewLoop = () => {
    if (previewIntervalRef.current) clearInterval(previewIntervalRef.current);
    previewIntervalRef.current = setInterval(async () => {
      // Don't preview while recording or in join screen
      if (isRecording || screen !== 'camera') return;

      try {
        const blob = captureJPEG();
        const res = await api('/detect_preview', 'POST', null, blob, { 'Content-Type': 'image/jpeg' });

        const ctx = overlayCanvasRef.current.getContext('2d');
        ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
        if (res.detected) {
          ctx.beginPath();
          ctx.arc(res.x_px, res.y_px, res.radius_px, 0, Math.PI * 2);
          ctx.lineWidth = 4;
          if (res.score > 0.75) ctx.strokeStyle = '#4CAF50';
          else if (res.score > 0.5) ctx.strokeStyle = '#FFEB3B';
          else ctx.strokeStyle = '#F44336';
          ctx.stroke();
        }
      } catch (e) { }
    }, PREVIEW_INTERVAL_MS);
  };

  const handleColorTap = (e) => {
    if (setupStage === 0 || setupStage > 3) return;

    const canvas = overlayCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const video = videoRef.current;
    const captureCanvas = captureCanvasRef.current;
    const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
    captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
    const imgData = captureCtx.getImageData(Math.max(0, Math.floor(x - 2)), Math.max(0, Math.floor(y - 2)), 5, 5).data;

    let r = 0, g = 0, b = 0;
    for (let i = 0; i < imgData.length; i += 4) {
      r += imgData[i]; g += imgData[i + 1]; b += imgData[i + 2];
    }
    const count = imgData.length / 4;
    r /= count; g /= count; b /= count;

    r /= 255; g /= 255; b /= 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, v = max;
    let d = max - min;
    s = max === 0 ? 0 : d / max;
    if (max === min) {
      h = 0;
    } else {
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }

    const newColor = {
      h: Math.round(h * 360),
      s: Math.round(s * 255),
      v: Math.round(v * 255)
    };

    setSampledColors(prev => {
        const next = [...prev, newColor];
        if (next.length < 3) {
            setSetupPrompt(colorPrompts[next.length]);
        } else {
            submitColors(next);
        }
        return next;
    });
    setSetupStage(prev => prev + 1);
  };

  const submitColors = async (colors) => {
    setSetupPrompt("Analyzing colors...");
    try {
      const payload = {
        small_ball_hsv: colors[0],
        sheet_hsv: colors[1],
        big_ball_hsv: colors[2]
      };
      const res = await api('/setup', 'POST', payload);
      setAccuracy({ score: res.accuracy_score, label: res.accuracy_label });
      setSetupResult(`Accuracy: ${res.accuracy_score}% (${res.accuracy_label})`);
      setSetupStage(4); // Finished setup
    } catch (e) {
      setError(e.message);
    }
  };

  const processQueue = async () => {
    if (isSendingRef.current || sendQueueRef.current.length === 0) return;
    isSendingRef.current = true;

    while (sendQueueRef.current.length > 0) {
      const item = sendQueueRef.current[0];
      try {
        await api('/frame', 'POST', null, item.blob, {
          'Content-Type': 'image/jpeg',
          'X-Frame-Index': item.index.toString()
        });
        sendQueueRef.current.shift();
      } catch (e) {
        setDroppedFrames(prev => prev + 1);
        sendQueueRef.current.shift();
      }
    }
    isSendingRef.current = false;
  };

  const toggleRecording = async () => {
    if (!isRecording) {
      setIsRecording(true);
      setScreen('record');
      
      if (previewIntervalRef.current) clearInterval(previewIntervalRef.current);
      const ctx = overlayCanvasRef.current.getContext('2d');
      ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);

      setFrameCount(0);
      setDroppedFrames(0);
      startTimeRef.current = Date.now();
      sendQueueRef.current = [];

      recordIntervalRef.current = setInterval(() => {
        const blob = captureJPEG();
        sendQueueRef.current.push({ blob: blob, index: sendQueueRef.current.length });
        setFrameCount(prev => prev + 1);

        const diff = Math.floor((Date.now() - startTimeRef.current) / 1000);
        const m = String(Math.floor(diff / 60)).padStart(2, '0');
        const s = String(diff % 60).padStart(2, '0');
        setTimer(`${m}:${s}`);

        processQueue();
      }, FRAME_INTERVAL_MS);
    } else {
      clearInterval(recordIntervalRef.current);
      setIsRecording(false);
      setScreen('processing');

      // Wait for queue to empty
      while (sendQueueRef.current.length > 0 || isSendingRef.current) {
        await new Promise(r => setTimeout(r, 100));
      }

      try {
        await api('/stop', 'POST', {});
      } catch (e) {
        alert(e.message);
      }
    }
  };

  const handleJoin = () => {
    const code = joinInput.trim().toUpperCase();
    if (code.length === 6) {
      setSessionCode(code);
      setScreen('camera');
    } else {
      setError("Invalid code length");
    }
  };

  return (
    <div id="app">
      {screen === 'join' && (
        <div id="join-screen" className="screen active full-center">
          <h1>Track Capture</h1>
          <p>Enter session code from laptop:</p>
          <input 
            type="text" 
            id="session-input" 
            maxLength="6" 
            placeholder="ABC123" 
            value={joinInput}
            onChange={(e) => setJoinInput(e.target.value)}
          />
          <button id="btn-join" className="primary" onClick={handleJoin}>Join Session</button>
          <div id="join-error" className="error">{error}</div>
        </div>
      )}

      {(screen === 'camera' || screen === 'record' || screen === 'processing') && (
        <div id="camera-container" style={{ display: 'block' }}>
          <video ref={videoRef} id="videoElement" autoPlay playsInline muted></video>
          <canvas 
            ref={overlayCanvasRef} 
            id="overlayCanvas" 
            onPointerDown={handleColorTap}
          ></canvas>
        </div>
      )}

      {screen === 'camera' && (
        <div id="setup-ui" className="overlay-ui">
          <div className="prompt-box">
            <p id="setup-prompt">{setupPrompt}</p>
            {setupStage === 0 && (
                <div id="setup-calib-step">
                    <button id="btn-capture-calib" className="primary" onClick={handleCalibrate}>Capture Marker</button>
                </div>
            )}
            {(setupStage > 0 && setupStage < 4) && (
                <div id="setup-color-step">
                    <div className="color-indicator">Samples: <span id="color-samples">{setupStage-1}/3</span></div>
                </div>
            )}
            <p id="setup-result" className="success">{setupResult}</p>
            <p id="setup-error" className="error">{error}</p>
            {setupStage === 4 && (
                <button id="btn-start-record" className="primary" onClick={() => setScreen('record')}>Go to Record</button>
            )}
          </div>
        </div>
      )}

      {screen === 'record' && (
        <div id="record-ui" className="overlay-ui record-layout">
          <div className="top-stats">
            <div id="rec-time">{timer}</div>
            <div id="rec-frames">Frames: {frameCount}</div>
            <div id="rec-dropped" className="error" style={{ display: droppedFrames > 0 ? 'block' : 'none' }}>Dropped: {droppedFrames}</div>
          </div>
          <button 
            id="btn-record-action" 
            className={`record-btn ${isRecording ? 'recording' : ''}`}
            onClick={toggleRecording}
          ></button>
          <p className="hint">Tap button to {isRecording ? "stop" : "start"} recording</p>
        </div>
      )}

      {screen === 'processing' && (
        <div id="processing-ui" className="overlay-ui full-center dark-bg">
          <div className="spinner"></div>
          <h2>Uploading...</h2>
          <p>Please wait until data is sent to laptop</p>
          <button onClick={() => setScreen('camera')} className="secondary" style={{marginTop: 20}}>Finish</button>
        </div>
      )}

      <canvas ref={captureCanvasRef} id="captureCanvas" style={{ display: 'none' }}></canvas>
    </div>
  );
}

export default App;
