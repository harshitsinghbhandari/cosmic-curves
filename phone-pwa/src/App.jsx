import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CONFIG } from './config';
import {
  Crosshair,
  Ruler,
  CircleDot,
  TestTube2,
  Video,
  Check,
  Loader2,
  Wifi,
  WifiOff,
  AlertTriangle,
  X
} from 'lucide-react';
import './index.css';

const API_BASE = CONFIG.API_BASE;
const FPS = 15;
const FRAME_INTERVAL_MS = Math.round(1000 / FPS);
const JPEG_QUALITY = 0.85;
const PREVIEW_INTERVAL_MS = 200;

// Setup stages
const STAGES = {
  MARKER_TAP: 0,      // Tap on marker to sample color
  MARKER_DISTANCE: 1, // Enter distance and detect markers
  MARKERS_DETECTED: 2,// Show marker line overlay
  SMALL_BALL_TAP: 3,  // Tap on small ball
  TEST_DETECTION: 4,  // Test detection preview
  READY: 5            // Ready to record
};

function App() {
  const [screen, setScreen] = useState('join');
  const [sessionCode, setSessionCode] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [error, setError] = useState('');
  const [setupPrompt, setSetupPrompt] = useState('Initializing camera...');
  const [setupResult, setSetupResult] = useState('');
  const [setupStage, setSetupStage] = useState(STAGES.MARKER_TAP);
  const [isRecording, setIsRecording] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [droppedFrames, setDroppedFrames] = useState(0);
  const [timer, setTimer] = useState('00:00');
  const [ripple, setRipple] = useState(null);
  const [queueDepth, setQueueDepth] = useState(0);
  const [networkHealth, setNetworkHealth] = useState('good');
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });

  // New state for marker-based setup
  const [markerColor, setMarkerColor] = useState(null);
  const [markerDistance, setMarkerDistance] = useState('10');
  const [markerResult, setMarkerResult] = useState(null);
  const [smallBallColor, setSmallBallColor] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Box selection state
  const [boxPos, setBoxPos] = useState({ x: 150, y: 150 }); // Center position
  const [boxSize, setBoxSize] = useState(50);
  const [isDraggingBox, setIsDraggingBox] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [capturedImage, setCapturedImage] = useState(null); // Still image for selection
  const [previewColor, setPreviewColor] = useState(null);

  const videoRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const recordIntervalRef = useRef(null);
  const previewIntervalRef = useRef(null);
  const startTimeRef = useRef(0);
  const sendQueueRef = useRef([]);
  const isSendingRef = useRef(false);
  const lastQueueCheckRef = useRef({ time: 0, depth: 0 });

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
          // Set initial box position to center of video
          setBoxPos({ x: videoWidth / 2, y: videoHeight / 2 });
          setSetupPrompt('Position box over marker');
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

  const captureBase64 = () => {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    return dataUrl.split(',')[1];
  };

  const triggerHaptic = () => {
    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
  };

  // Capture still image for color selection
  const captureStillImage = () => {
    const video = videoRef.current;
    const captureCanvas = captureCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;

    if (!video || !captureCanvas || !overlayCanvas) {
      console.error('[DEBUG] Missing refs');
      return;
    }

    // Draw to capture canvas (for sampling)
    const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
    captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

    // Also draw to overlay canvas (for display)
    const overlayCtx = overlayCanvas.getContext('2d');
    overlayCtx.drawImage(video, 0, 0, overlayCanvas.width, overlayCanvas.height);

    console.log('[DEBUG] Captured to both canvases');

    // Use a simple flag
    setCapturedImage('captured');

    // Center the box
    setBoxPos({ x: captureCanvas.width / 2, y: captureCanvas.height / 2 });
    triggerHaptic();
  };

  // Retake - clear captured image
  const retakeImage = () => {
    console.log('[DEBUG] retakeImage called');
    setCapturedImage(null);
    setPreviewColor(null);

    // Clear the overlay canvas
    const overlayCanvas = overlayCanvasRef.current;
    if (overlayCanvas) {
      const ctx = overlayCanvas.getContext('2d');
      ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }

    triggerHaptic();
  };

  // Debug: log when capturedImage changes
  useEffect(() => {
    console.log('[DEBUG] capturedImage state changed:', capturedImage ? `${capturedImage.length} chars` : 'null');
  }, [capturedImage]);

  const sampleColorAtPoint = (x, y) => {
    const video = videoRef.current;
    const captureCanvas = captureCanvasRef.current;
    const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
    captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

    const imgData = captureCtx.getImageData(
      Math.max(0, Math.floor(x - 2)),
      Math.max(0, Math.floor(y - 2)),
      5, 5
    ).data;

    let r = 0, g = 0, b = 0;
    for (let i = 0; i < imgData.length; i += 4) {
      r += imgData[i];
      g += imgData[i + 1];
      b += imgData[i + 2];
    }
    const count = imgData.length / 4;
    r = Math.round(r / count);
    g = Math.round(g / count);
    b = Math.round(b / count);

    return { r, g, b, rgb: `rgb(${r}, ${g}, ${b})` };
  };

  // Sample average color from the selection box on captured canvas
  const sampleColorFromBox = useCallback(() => {
    const canvas = captureCanvasRef.current;
    if (!capturedImage || !canvas) return null;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Calculate box bounds
    const halfSize = boxSize / 2;
    const x1 = Math.max(0, Math.floor(boxPos.x - halfSize));
    const y1 = Math.max(0, Math.floor(boxPos.y - halfSize));
    const x2 = Math.min(canvas.width, Math.floor(boxPos.x + halfSize));
    const y2 = Math.min(canvas.height, Math.floor(boxPos.y + halfSize));

    const width = x2 - x1;
    const height = y2 - y1;
    if (width <= 0 || height <= 0) return null;

    const imgData = ctx.getImageData(x1, y1, width, height).data;

    let r = 0, g = 0, b = 0;
    for (let i = 0; i < imgData.length; i += 4) {
      r += imgData[i];
      g += imgData[i + 1];
      b += imgData[i + 2];
    }
    const count = imgData.length / 4;
    r = Math.round(r / count);
    g = Math.round(g / count);
    b = Math.round(b / count);

    return { r, g, b, rgb: `rgb(${r}, ${g}, ${b})` };
  }, [capturedImage, boxPos, boxSize]);

  // Update preview color when box moves
  useEffect(() => {
    if (capturedImage && (setupStage === STAGES.MARKER_TAP || setupStage === STAGES.SMALL_BALL_TAP)) {
      const color = sampleColorFromBox();
      setPreviewColor(color);
    }
  }, [capturedImage, boxPos, boxSize, setupStage, sampleColorFromBox]);

  // Draw the selection box overlay (only when captured image exists)
  const drawBoxOverlay = useCallback(() => {
    const overlayCanvas = overlayCanvasRef.current;
    const captureCanvas = captureCanvasRef.current;
    if (!overlayCanvas || !capturedImage) return;

    // Only draw box during marker selection stages
    if (setupStage !== STAGES.MARKER_TAP && setupStage !== STAGES.SMALL_BALL_TAP) return;

    const ctx = overlayCanvas.getContext('2d');

    // Redraw the captured image first (from capture canvas)
    if (captureCanvas) {
      ctx.drawImage(captureCanvas, 0, 0, overlayCanvas.width, overlayCanvas.height);
    }

    const halfSize = boxSize / 2;
    const x = boxPos.x - halfSize;
    const y = boxPos.y - halfSize;

    // Draw box outline with glow effect
    ctx.shadowColor = '#00FF00';
    ctx.shadowBlur = 15;
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, boxSize, boxSize);
    ctx.shadowBlur = 0;

    // Draw crosshair
    ctx.beginPath();
    ctx.moveTo(boxPos.x - 20, boxPos.y);
    ctx.lineTo(boxPos.x + 20, boxPos.y);
    ctx.moveTo(boxPos.x, boxPos.y - 20);
    ctx.lineTo(boxPos.x, boxPos.y + 20);
    ctx.stroke();
  }, [boxPos, boxSize, setupStage, capturedImage]);

  // Update box overlay when box moves (only when image is captured)
  useEffect(() => {
    if (!capturedImage) return;
    if (setupStage !== STAGES.MARKER_TAP && setupStage !== STAGES.SMALL_BALL_TAP) return;
    drawBoxOverlay();
  }, [capturedImage, boxPos, boxSize, setupStage, drawBoxOverlay]);

  // Handle touch/mouse start for box dragging
  const handlePointerDown = (e) => {
    if (!capturedImage) return; // Only drag when image is captured
    if (setupStage !== STAGES.MARKER_TAP && setupStage !== STAGES.SMALL_BALL_TAP) return;

    const canvas = overlayCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const pointerX = (e.clientX - rect.left) * scaleX;
    const pointerY = (e.clientY - rect.top) * scaleY;

    // Start dragging - set offset from box center
    setIsDraggingBox(true);
    setDragOffset({ x: pointerX - boxPos.x, y: pointerY - boxPos.y });
    triggerHaptic();
  };

  // Handle touch/mouse move for box dragging
  const handlePointerMove = (e) => {
    if (!isDraggingBox || !capturedImage) return;
    if (setupStage !== STAGES.MARKER_TAP && setupStage !== STAGES.SMALL_BALL_TAP) return;

    const canvas = overlayCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const pointerX = (e.clientX - rect.left) * scaleX;
    const pointerY = (e.clientY - rect.top) * scaleY;

    // Update box position
    const halfSize = boxSize / 2;
    const newX = Math.max(halfSize, Math.min(canvas.width - halfSize, pointerX - dragOffset.x));
    const newY = Math.max(halfSize, Math.min(canvas.height - halfSize, pointerY - dragOffset.y));

    setBoxPos({ x: newX, y: newY });
  };

  // Handle touch/mouse end for box dragging
  const handlePointerUp = () => {
    setIsDraggingBox(false);
  };

  // Handle box size change
  const handleBoxSizeChange = (delta) => {
    setBoxSize(prev => Math.max(30, Math.min(60, prev + delta)));
    triggerHaptic();
  };

  // Sample color from box and proceed
  const handleSampleFromBox = () => {
    const color = previewColor || sampleColorFromBox();
    if (!color) {
      setError('Failed to sample color');
      return;
    }

    triggerHaptic();

    // Clear captured image for next stage
    setCapturedImage(null);
    setPreviewColor(null);

    if (setupStage === STAGES.MARKER_TAP) {
      setMarkerColor(color);
      setSetupStage(STAGES.MARKER_DISTANCE);
      setSetupPrompt('Enter marker distance (cm)');
      setSetupResult('Marker color sampled');
    } else if (setupStage === STAGES.SMALL_BALL_TAP) {
      setSmallBallColor(color);
      submitSmallBallColor(color);
    }
  };

  const handleDetectMarkers = async () => {
    if (!markerColor || !markerDistance) return;

    setIsLoading(true);
    setError('');

    try {
      // Get base64 from the CAPTURED frame (not live video)
      const canvas = captureCanvasRef.current;
      const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      const base64Image = dataUrl.split(',')[1];

      console.log('[DEBUG] Sending captured frame, base64 length:', base64Image.length);

      const payload = {
        marker_color: { r: markerColor.r, g: markerColor.g, b: markerColor.b },
        marker_distance_cm: parseFloat(markerDistance),
        image: base64Image
      };

      const res = await api('/calibrate', 'POST', payload);

      setMarkerResult(res);
      setSetupStage(STAGES.MARKERS_DETECTED);
      setSetupPrompt('Markers detected! Now tap the small ball');
      setSetupResult(`Scale: ${res.px_per_cm.toFixed(1)} px/cm`);

      drawMarkerOverlay(res);

      setTimeout(() => {
        setSetupStage(STAGES.SMALL_BALL_TAP);
        setSetupPrompt('Tap on the small ball');
      }, 2000);

    } catch (e) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const drawMarkerOverlay = (result) => {
    const ctx = overlayCanvasRef.current.getContext('2d');
    ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);

    const { marker1, marker2, y_axis } = result;

    ctx.strokeStyle = '#FF00FF';
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);

    ctx.beginPath();
    ctx.arc(marker1.x_px, marker1.y_px, 30, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(marker2.x_px, marker2.y_px, 30, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(marker1.x_px, marker1.y_px);
    ctx.lineTo(marker2.x_px, marker2.y_px);
    ctx.stroke();

    ctx.setLineDash([]);

    const midX = (marker1.x_px + marker2.x_px) / 2;
    const midY = (marker1.y_px + marker2.y_px) / 2;
    const arrowLength = 60;

    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    ctx.lineTo(midX + y_axis[0] * arrowLength, midY + y_axis[1] * arrowLength);
    ctx.stroke();

    const headLength = 10;
    const angle = Math.atan2(y_axis[1], y_axis[0]);
    ctx.beginPath();
    ctx.moveTo(midX + y_axis[0] * arrowLength, midY + y_axis[1] * arrowLength);
    ctx.lineTo(
      midX + y_axis[0] * arrowLength - headLength * Math.cos(angle - Math.PI / 6),
      midY + y_axis[1] * arrowLength - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(midX + y_axis[0] * arrowLength, midY + y_axis[1] * arrowLength);
    ctx.lineTo(
      midX + y_axis[0] * arrowLength - headLength * Math.cos(angle + Math.PI / 6),
      midY + y_axis[1] * arrowLength - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.stroke();

    ctx.fillStyle = '#00FF00';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('Y', midX + y_axis[0] * arrowLength + 10, midY + y_axis[1] * arrowLength);
  };

  const submitSmallBallColor = async (color) => {
    setIsLoading(true);
    setError('');

    try {
      const payload = { small_ball_color: { r: color.r, g: color.g, b: color.b } };
      await api('/setup', 'POST', payload);

      setSetupStage(STAGES.TEST_DETECTION);
      setSetupPrompt('Small ball color set. Test detection?');
      setSetupResult('Color sampled');
      startPreviewLoop();

    } catch (e) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestDetection = async () => {
    setIsLoading(true);
    setError('');

    try {
      const blob = captureJPEG();
      const res = await api('/test_detection', 'POST', null, blob, { 'Content-Type': 'image/jpeg' });

      setTestResult(res);

      if (res.success) {
        setSetupStage(STAGES.READY);
        setSetupPrompt('Detection successful! Ready to record.');
        setSetupResult('Both balls detected');
      } else {
        setError('Detection incomplete - adjust lighting or positions');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const startPreviewLoop = () => {
    if (previewIntervalRef.current) clearInterval(previewIntervalRef.current);
    previewIntervalRef.current = setInterval(async () => {
      if (isRecording || screen !== 'camera') return;
      if (setupStage < STAGES.SMALL_BALL_TAP) return;

      try {
        const blob = captureJPEG();
        const res = await api('/detect_preview', 'POST', null, blob, { 'Content-Type': 'image/jpeg' });

        const ctx = overlayCanvasRef.current.getContext('2d');
        ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);

        if (markerResult && setupStage >= STAGES.MARKERS_DETECTED) {
          drawMarkerOverlay(markerResult);
        }

        if (res.detected) {
          ctx.beginPath();
          ctx.arc(res.x_px, res.y_px, res.radius_px || 20, 0, Math.PI * 2);
          ctx.lineWidth = 4;
          if (res.score > 0.75) ctx.strokeStyle = '#4CAF50';
          else if (res.score > 0.5) ctx.strokeStyle = '#FFEB3B';
          else ctx.strokeStyle = '#F44336';
          ctx.stroke();
        }
      } catch (e) { }
    }, PREVIEW_INTERVAL_MS);
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
        setUploadProgress(prev => ({ ...prev, current: prev.current + 1 }));
      } catch (e) {
        setDroppedFrames(prev => prev + 1);
        sendQueueRef.current.shift();
      }
    }
    isSendingRef.current = false;
  };

  const updateNetworkHealth = () => {
    const now = Date.now();
    const currentDepth = sendQueueRef.current.length;
    const { time: lastTime, depth: lastDepth } = lastQueueCheckRef.current;

    if (now - lastTime > 1000) {
      const growth = currentDepth - lastDepth;
      if (growth > 5) {
        setNetworkHealth('slow');
      } else if (currentDepth > 20) {
        setNetworkHealth('stalled');
      } else {
        setNetworkHealth('good');
      }
      lastQueueCheckRef.current = { time: now, depth: currentDepth };
    }

    setQueueDepth(currentDepth);
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
      setUploadProgress({ current: 0, total: 0 });
      startTimeRef.current = Date.now();
      sendQueueRef.current = [];
      lastQueueCheckRef.current = { time: Date.now(), depth: 0 };

      recordIntervalRef.current = setInterval(() => {
        const blob = captureJPEG();
        const newIndex = sendQueueRef.current.length;
        sendQueueRef.current.push({ blob: blob, index: newIndex });
        setFrameCount(prev => {
          const newCount = prev + 1;
          setUploadProgress(p => ({ ...p, total: newCount }));
          return newCount;
        });

        const diff = Math.floor((Date.now() - startTimeRef.current) / 1000);
        const m = String(Math.floor(diff / 60)).padStart(2, '0');
        const s = String(diff % 60).padStart(2, '0');
        setTimer(`${m}:${s}`);

        updateNetworkHealth();
        processQueue();
      }, FRAME_INTERVAL_MS);
    } else {
      clearInterval(recordIntervalRef.current);
      setIsRecording(false);
      setScreen('processing');

      while (sendQueueRef.current.length > 0 || isSendingRef.current) {
        setUploadProgress(prev => ({
          ...prev,
          current: prev.total - sendQueueRef.current.length
        }));
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

  const getStepperStage = () => {
    if (setupStage <= STAGES.MARKER_DISTANCE) return 0;
    if (setupStage <= STAGES.SMALL_BALL_TAP) return 1;
    if (setupStage <= STAGES.TEST_DETECTION) return 2;
    return 3;
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
          {error && <div id="join-error" className="error">{error}</div>}
        </div>
      )}

      {(screen === 'camera' || screen === 'record' || screen === 'processing') && (
        <div id="camera-container" style={{ display: 'block' }}>
          {/* Video always visible - captured frame drawn on overlay canvas */}
          <video
            ref={videoRef}
            id="videoElement"
            autoPlay
            playsInline
            muted
          ></video>
          <canvas
            ref={overlayCanvasRef}
            id="overlayCanvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            style={{ touchAction: 'none' }}
          ></canvas>
          {ripple && (
            <div
              className="tap-ripple"
              style={{ left: ripple.x, top: ripple.y }}
              key={ripple.id}
            />
          )}
        </div>
      )}

      {screen === 'camera' && (
        <div id="setup-ui" className="overlay-ui">
          <div className="setup-stepper">
            <div className={`step ${getStepperStage() >= 0 ? 'active' : ''} ${getStepperStage() > 0 ? 'completed' : ''}`}>
              <div className="step-icon">
                {getStepperStage() > 0 ? <Check size={16} /> : <Crosshair size={16} />}
              </div>
              <span className="step-label">Markers</span>
            </div>
            <div className="step-connector"></div>
            <div className={`step ${getStepperStage() >= 1 ? 'active' : ''} ${getStepperStage() > 1 ? 'completed' : ''}`}>
              <div className="step-icon">
                {getStepperStage() > 1 ? <Check size={16} /> : <CircleDot size={16} />}
              </div>
              <span className="step-label">Ball</span>
            </div>
            <div className="step-connector"></div>
            <div className={`step ${getStepperStage() >= 2 ? 'active' : ''} ${getStepperStage() > 2 ? 'completed' : ''}`}>
              <div className="step-icon">
                {getStepperStage() > 2 ? <Check size={16} /> : <TestTube2 size={16} />}
              </div>
              <span className="step-label">Test</span>
            </div>
            <div className="step-connector"></div>
            <div className={`step ${getStepperStage() >= 3 ? 'active' : ''}`}>
              <div className="step-icon">
                <Video size={16} />
              </div>
              <span className="step-label">Record</span>
            </div>
          </div>

          <div className="prompt-box">
            <p id="setup-prompt">{setupPrompt}</p>

            {setupStage === STAGES.MARKER_TAP && (
              <div id="setup-marker-tap">
                {!capturedImage ? (
                  <>
                    <p className="hint-text">Point camera at your markers</p>
                    <button className="primary capture-btn" onClick={captureStillImage}>
                      <Crosshair size={18} />
                      Capture Image
                    </button>
                  </>
                ) : (
                  <>
                    <p className="hint-text">Drag box over a marker</p>
                    {previewColor && (
                      <div className="color-preview-bar">
                        <div className="preview-swatch" style={{ backgroundColor: previewColor.rgb }}></div>
                        <span className="preview-label">Selected: RGB({previewColor.r}, {previewColor.g}, {previewColor.b})</span>
                      </div>
                    )}
                    <div className="box-controls">
                      <button className="size-btn" onClick={() => handleBoxSizeChange(-5)}>−</button>
                      <span className="box-size-label">{boxSize}px</span>
                      <button className="size-btn" onClick={() => handleBoxSizeChange(5)}>+</button>
                    </div>
                    <div className="action-buttons">
                      <button className="secondary" onClick={retakeImage}>
                        Retake
                      </button>
                      <button className="primary" onClick={handleSampleFromBox}>
                        <Check size={18} />
                        Confirm Color
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {setupStage === STAGES.MARKER_DISTANCE && (
              <div id="setup-marker-distance">
                <div className="color-preview">
                  <div className="swatch-circle sampled" style={{ backgroundColor: markerColor?.rgb }}>
                    <Check size={12} />
                  </div>
                  <span>Marker color</span>
                </div>
                <div className="distance-input-group">
                  <Ruler size={18} />
                  <input
                    type="number"
                    value={markerDistance}
                    onChange={(e) => setMarkerDistance(e.target.value)}
                    placeholder="10"
                    className="distance-input"
                  />
                  <span className="unit">cm</span>
                </div>
                <button
                  className="primary"
                  onClick={handleDetectMarkers}
                  disabled={isLoading || !markerDistance}
                >
                  {isLoading ? <Loader2 size={18} className="spinning" /> : <Crosshair size={18} />}
                  Detect Markers
                </button>
              </div>
            )}

            {setupStage === STAGES.MARKERS_DETECTED && (
              <div id="setup-markers-detected">
                <div className="detection-success">
                  <Check size={24} className="success-icon" />
                  <span>{setupResult}</span>
                </div>
              </div>
            )}

            {setupStage === STAGES.SMALL_BALL_TAP && (
              <div id="setup-small-ball">
                {!capturedImage ? (
                  <>
                    <p className="hint-text">Point camera at the small ball</p>
                    <button className="primary capture-btn" onClick={captureStillImage}>
                      <CircleDot size={18} />
                      Capture Image
                    </button>
                  </>
                ) : (
                  <>
                    <p className="hint-text">Drag box over the small ball</p>
                    {previewColor && (
                      <div className="color-preview-bar">
                        <div className="preview-swatch" style={{ backgroundColor: previewColor.rgb }}></div>
                        <span className="preview-label">Selected: RGB({previewColor.r}, {previewColor.g}, {previewColor.b})</span>
                      </div>
                    )}
                    <div className="box-controls">
                      <button className="size-btn" onClick={() => handleBoxSizeChange(-5)}>−</button>
                      <span className="box-size-label">{boxSize}px</span>
                      <button className="size-btn" onClick={() => handleBoxSizeChange(5)}>+</button>
                    </div>
                    <div className="action-buttons">
                      <button className="secondary" onClick={retakeImage}>
                        Retake
                      </button>
                      <button className="primary" onClick={handleSampleFromBox} disabled={isLoading}>
                        {isLoading ? <Loader2 size={18} className="spinning" /> : <Check size={18} />}
                        Confirm Color
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {setupStage === STAGES.TEST_DETECTION && (
              <div id="setup-test-detection">
                <div className="color-swatches-row">
                  <div className="color-preview compact">
                    <div className="swatch-circle sampled" style={{ backgroundColor: markerColor?.rgb }}></div>
                    <span>Marker</span>
                  </div>
                  <div className="color-preview compact">
                    <div className="swatch-circle sampled" style={{ backgroundColor: smallBallColor?.rgb }}></div>
                    <span>Ball</span>
                  </div>
                </div>
                <button
                  className="primary"
                  onClick={handleTestDetection}
                  disabled={isLoading}
                >
                  {isLoading ? <Loader2 size={18} className="spinning" /> : <TestTube2 size={18} />}
                  Test Detection
                </button>
              </div>
            )}

            {setupStage === STAGES.READY && (
              <div id="setup-ready">
                <div className="detection-success">
                  <Check size={24} className="success-icon" />
                  <span>Detection verified!</span>
                </div>
                <button className="primary" onClick={() => setScreen('record')}>
                  <Video size={18} />
                  Start Recording
                </button>
              </div>
            )}

            {setupResult && setupStage > STAGES.MARKER_TAP && setupStage < STAGES.READY && (
              <p id="setup-result" className="success">
                <Check size={16} /> {setupResult}
              </p>
            )}

            {error && (
              <p id="setup-error" className="error">
                <AlertTriangle size={16} /> {error}
              </p>
            )}
          </div>
        </div>
      )}

      {testResult && testResult.annotated_image && setupStage === STAGES.TEST_DETECTION && (
        <div className="test-preview-modal">
          <div className={`test-preview-content ${testResult.success ? 'success' : 'failure'}`}>
            <button className="close-btn" onClick={() => setTestResult(null)}>
              <X size={20} />
            </button>
            <img
              src={`data:image/jpeg;base64,${testResult.annotated_image}`}
              alt="Detection preview"
              className="preview-image"
            />
            <div className="preview-status">
              {testResult.success ? (
                <>
                  <Check size={20} className="status-icon success" />
                  <span>Both balls detected!</span>
                </>
              ) : (
                <>
                  <AlertTriangle size={20} className="status-icon error" />
                  <span>Detection incomplete</span>
                </>
              )}
            </div>
            <div className="preview-details">
              <div className={`detail-item ${testResult.small_ball?.detected ? 'detected' : 'not-detected'}`}>
                Small Ball: {testResult.small_ball?.detected ? 'Found' : 'Not found'}
              </div>
              <div className={`detail-item ${testResult.big_ball?.detected ? 'detected' : 'not-detected'}`}>
                Big Ball: {testResult.big_ball?.detected ? 'Found' : 'Not found'}
              </div>
            </div>
            {testResult.success && (
              <button className="primary" onClick={() => {
                setTestResult(null);
                setSetupStage(STAGES.READY);
                setSetupPrompt('Detection successful! Ready to record.');
              }}>
                Continue
              </button>
            )}
            {!testResult.success && (
              <button className="secondary" onClick={() => setTestResult(null)}>
                Try Again
              </button>
            )}
          </div>
        </div>
      )}

      {screen === 'record' && (
        <div id="record-ui" className="overlay-ui record-layout">
          <div className="recording-stats-panel">
            <div className="stat-item timer">
              <span className="stat-value">{timer}</span>
            </div>
            <div className="stat-item">
              <CircleDot size={14} className="stat-icon" />
              <span className="stat-value">{frameCount}</span>
              <span className="stat-label">frames</span>
            </div>
            <div className="stat-item">
              <Loader2 size={14} className={`stat-icon ${queueDepth > 0 ? 'spinning' : ''}`} />
              <span className="stat-value">{queueDepth}</span>
              <span className="stat-label">buffered</span>
            </div>
            <div className={`network-indicator ${networkHealth}`}>
              {networkHealth === 'good' ? <Wifi size={14} /> : <WifiOff size={14} />}
            </div>
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
          <Loader2 size={48} className="spinning" />
          <h2>Uploading Frames</h2>
          <div className="upload-progress">
            <div className="upload-progress-bar">
              <div
                className="upload-progress-fill"
                style={{ width: `${uploadProgress.total > 0 ? (uploadProgress.current / uploadProgress.total) * 100 : 0}%` }}
              ></div>
            </div>
            <p className="upload-count">
              {uploadProgress.current} of {uploadProgress.total} frames
            </p>
          </div>
          <div className={`upload-health ${networkHealth}`}>
            {networkHealth === 'good' && <><Wifi size={14} /> Good</>}
            {networkHealth === 'slow' && <><WifiOff size={14} /> Slow</>}
            {networkHealth === 'stalled' && <><AlertTriangle size={14} /> Stalled</>}
          </div>
          <button onClick={() => setScreen('camera')} className="secondary" style={{ marginTop: 20 }}>Finish</button>
        </div>
      )}

      {/* Hidden canvas for capturing frames */}
      <canvas ref={captureCanvasRef} id="captureCanvas" style={{ display: 'none' }}></canvas>
    </div>
  );
}

export default App;
