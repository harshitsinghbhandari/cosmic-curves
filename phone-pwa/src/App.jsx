import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CONFIG } from './config';
import {
  Crosshair,
  Video,
  Check,
  Loader2,
  Wifi,
  WifiOff,
  Camera,
  RotateCcw,
  Square,
  Minus,
  Plus,
  X,
  AlertTriangle
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
  MARKERS_DETECTED: 2,// Show marker line overlay (auto-advance)
  SMALL_BALL_TAP: 3,  // Tap on small ball to sample color
  BIG_BALL_TAP: 4,    // Tap on big ball to sample color
  READY: 5            // Ready to record
};

// Stage labels for UI
const STAGE_LABELS = {
  [STAGES.MARKER_TAP]: { title: 'Calibration Markers', subtitle: 'Sample marker color' },
  [STAGES.MARKER_DISTANCE]: { title: 'Calibration Markers', subtitle: 'Enter distance & detect' },
  [STAGES.MARKERS_DETECTED]: { title: 'Calibration Markers', subtitle: 'Markers detected!' },
  [STAGES.SMALL_BALL_TAP]: { title: 'Small Ball', subtitle: 'Sample small ball color' },
  [STAGES.BIG_BALL_TAP]: { title: 'Big Ball', subtitle: 'Sample big ball color' },
  [STAGES.READY]: { title: 'Ready', subtitle: 'Start recording' },
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
  const [markerPreview, setMarkerPreview] = useState(null); // For showing detected markers preview
  const [smallBallColor, setSmallBallColor] = useState(null);
  const [bigBallColor, setBigBallColor] = useState(null);
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
  const stageAdvanceTimeoutRef = useRef(null);
  const startTimeRef = useRef(0);
  const sendQueueRef = useRef([]);
  const isSendingRef = useRef(false);
  const lastQueueCheckRef = useRef({ time: 0, depth: 0 });
  // Refs for preview loop closure (to avoid stale closure issues)
  const isRecordingRef = useRef(false);
  const screenRef = useRef('join');
  const setupStageRef = useRef(STAGES.MARKER_TAP);
  const markerResultRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('session')) {
      const code = params.get('session').toUpperCase();
      setSessionCode(code);
      setScreen('camera');
    }
  }, []);

  // Keep refs in sync with state for preview loop closure
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { screenRef.current = screen; }, [screen]);
  useEffect(() => { setupStageRef.current = setupStage; }, [setupStage]);
  useEffect(() => { markerResultRef.current = markerResult; }, [markerResult]);

  const api = useCallback(async (path, method = "GET", bodyObj = null, rawBody = null, extraHeaders = {}) => {
    if (!sessionCode) {
      throw new Error('No session code - please rejoin the session');
    }
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
    // Clear preview interval when leaving camera screen
    if (screen !== 'camera' && previewIntervalRef.current) {
      clearInterval(previewIntervalRef.current);
      previewIntervalRef.current = null;
    }
  }, [screen, startCamera]);

  // Cleanup all intervals and timeouts on unmount
  useEffect(() => {
    return () => {
      if (previewIntervalRef.current) {
        clearInterval(previewIntervalRef.current);
        previewIntervalRef.current = null;
      }
      if (recordIntervalRef.current) {
        clearInterval(recordIntervalRef.current);
        recordIntervalRef.current = null;
      }
      if (stageAdvanceTimeoutRef.current) {
        clearTimeout(stageAdvanceTimeoutRef.current);
        stageAdvanceTimeoutRef.current = null;
      }
      // Stop camera stream
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = videoRef.current.srcObject.getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, []);

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
    if (capturedImage && (setupStage === STAGES.MARKER_TAP || setupStage === STAGES.SMALL_BALL_TAP || setupStage === STAGES.BIG_BALL_TAP)) {
      const color = sampleColorFromBox();
      setPreviewColor(color);
    }
  }, [capturedImage, boxPos, boxSize, setupStage, sampleColorFromBox]);

  // Draw the selection box overlay (only when captured image exists)
  const drawBoxOverlay = useCallback(() => {
    const overlayCanvas = overlayCanvasRef.current;
    const captureCanvas = captureCanvasRef.current;
    if (!overlayCanvas || !capturedImage) return;

    // Only draw box during color sampling stages
    if (setupStage !== STAGES.MARKER_TAP && setupStage !== STAGES.SMALL_BALL_TAP && setupStage !== STAGES.BIG_BALL_TAP) return;

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
    if (setupStage !== STAGES.MARKER_TAP && setupStage !== STAGES.SMALL_BALL_TAP && setupStage !== STAGES.BIG_BALL_TAP) return;
    drawBoxOverlay();
  }, [capturedImage, boxPos, boxSize, setupStage, drawBoxOverlay]);

  // Handle touch/mouse start for box dragging
  const handlePointerDown = (e) => {
    if (!capturedImage) return; // Only drag when image is captured
    if (setupStage !== STAGES.MARKER_TAP && setupStage !== STAGES.SMALL_BALL_TAP && setupStage !== STAGES.BIG_BALL_TAP) return;

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
    if (setupStage !== STAGES.MARKER_TAP && setupStage !== STAGES.SMALL_BALL_TAP && setupStage !== STAGES.BIG_BALL_TAP) return;

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
    setBoxSize(prev => Math.max(10, Math.min(60, prev + delta)));
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
      setSetupResult('Marker color sampled');
    } else if (setupStage === STAGES.SMALL_BALL_TAP) {
      setSmallBallColor(color);
      submitSmallBallColor(color);
    } else if (setupStage === STAGES.BIG_BALL_TAP) {
      setBigBallColor(color);
      submitBigBallColor(color);
    }
  };

  // Reset to retry marker detection
  const retryMarkerDetection = () => {
    setMarkerColor(null);
    setMarkerResult(null);
    setMarkerPreview(null);
    setCapturedImage(null);
    setPreviewColor(null);
    setError('');
    setSetupStage(STAGES.MARKER_TAP);

    // Clear overlay
    const ctx = overlayCanvasRef.current?.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
  };

  // Reset to retry small ball color
  const retrySmallBall = () => {
    setSmallBallColor(null);
    setCapturedImage(null);
    setPreviewColor(null);
    setError('');
    setSetupStage(STAGES.SMALL_BALL_TAP);
  };

  // Reset to retry big ball color
  const retryBigBall = () => {
    setBigBallColor(null);
    setCapturedImage(null);
    setPreviewColor(null);
    setError('');
    setSetupStage(STAGES.BIG_BALL_TAP);
  };

  const handleDetectMarkers = async () => {
    if (!markerColor || !markerDistance) return;

    // Validate marker distance
    const distance = parseFloat(markerDistance);
    if (isNaN(distance) || distance <= 0 || distance > 1000) {
      setError('Enter a valid distance (1-1000 cm)');
      return;
    }

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

      // Show preview with detected markers
      setMarkerPreview(res);

    } catch (e) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Accept marker detection and proceed
  const acceptMarkerDetection = () => {
    if (!markerPreview) return;

    setMarkerResult(markerPreview);
    setSetupStage(STAGES.MARKERS_DETECTED);
    setSetupPrompt('Markers detected! Now tap the small ball');
    setSetupResult(`Scale: ${markerPreview.px_per_cm.toFixed(1)} px/cm`);

    drawMarkerOverlay(markerPreview);
    setMarkerPreview(null);

    // Clear any existing timeout before setting new one
    if (stageAdvanceTimeoutRef.current) {
      clearTimeout(stageAdvanceTimeoutRef.current);
    }
    stageAdvanceTimeoutRef.current = setTimeout(() => {
      // Only advance if still on MARKERS_DETECTED stage
      setSetupStage(prev => {
        if (prev === STAGES.MARKERS_DETECTED) {
          setSetupPrompt('Tap on the small ball');
          return STAGES.SMALL_BALL_TAP;
        }
        return prev;
      });
    }, 2000);
  };

  const drawMarkerOverlay = (result) => {
    if (!overlayCanvasRef.current) return;
    const ctx = overlayCanvasRef.current.getContext('2d');
    ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);

    // Validate required fields exist
    if (!result || !result.marker1 || !result.marker2 || !result.y_axis) {
      console.warn('[drawMarkerOverlay] Missing required fields in result');
      return;
    }

    const { marker1, marker2, y_axis } = result;

    // Validate marker pixel coordinates
    if (typeof marker1.x_px !== 'number' || typeof marker1.y_px !== 'number' ||
        typeof marker2.x_px !== 'number' || typeof marker2.y_px !== 'number') {
      console.warn('[drawMarkerOverlay] Invalid marker coordinates');
      return;
    }

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

      // Advance to big ball stage
      setSetupStage(STAGES.BIG_BALL_TAP);
      setSetupResult('Small ball color set');

    } catch (e) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const submitBigBallColor = async (color) => {
    setIsLoading(true);
    setError('');

    try {
      const payload = { big_ball_color: { r: color.r, g: color.g, b: color.b } };
      await api('/setup', 'POST', payload);

      // Go directly to READY stage
      setSetupStage(STAGES.READY);
      setSetupResult('Setup complete');

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
      // Use refs to avoid stale closure
      if (isRecordingRef.current || screenRef.current !== 'camera') return;
      if (setupStageRef.current < STAGES.SMALL_BALL_TAP) return;

      try {
        const blob = captureJPEG();
        const res = await api('/detect_preview', 'POST', null, blob, { 'Content-Type': 'image/jpeg' });

        if (!overlayCanvasRef.current) return;
        const ctx = overlayCanvasRef.current.getContext('2d');
        ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);

        if (markerResultRef.current && setupStageRef.current >= STAGES.MARKERS_DETECTED) {
          drawMarkerOverlay(markerResultRef.current);
        }

        if (res && res.detected) {
          ctx.beginPath();
          ctx.arc(res.x_px, res.y_px, res.radius_px || 20, 0, Math.PI * 2);
          ctx.lineWidth = 4;
          if (res.score > 0.75) ctx.strokeStyle = '#4CAF50';
          else if (res.score > 0.5) ctx.strokeStyle = '#FFEB3B';
          else ctx.strokeStyle = '#F44336';
          ctx.stroke();
        }
      } catch (e) {
        // Log preview errors for debugging but don't show to user
        console.warn('[Preview] Detection error:', e.message);
      }
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
        <>
          {/* Right sidebar - always visible */}
          <div className="sidebar">
            {/* Stage indicator dots */}
            <div className="stage-dots">
              {[0, 1, 2, 3, 4, 5].map(i => (
                <div
                  key={i}
                  className={`dot ${setupStage > i ? 'completed' : ''} ${setupStage === i ? 'active' : ''}`}
                />
              ))}
            </div>

            {/* MARKER_TAP, SMALL_BALL_TAP, or BIG_BALL_TAP stages - color sampling */}
            {(setupStage === STAGES.MARKER_TAP || setupStage === STAGES.SMALL_BALL_TAP || setupStage === STAGES.BIG_BALL_TAP) && (
              <>
                {!capturedImage ? (
                  <button className="sidebar-btn primary" onClick={captureStillImage}>
                    <Camera size={20} />
                  </button>
                ) : (
                  <>
                    <button className="sidebar-btn" onClick={() => handleBoxSizeChange(-5)}>
                      <Minus size={18} />
                    </button>
                    <span className="size-label">{boxSize}</span>
                    <button className="sidebar-btn" onClick={() => handleBoxSizeChange(5)}>
                      <Plus size={18} />
                    </button>
                    <div className="sidebar-divider" />
                    <button className="sidebar-btn" onClick={retakeImage}>
                      <RotateCcw size={18} />
                    </button>
                    <button
                      className="sidebar-btn primary"
                      onClick={handleSampleFromBox}
                      disabled={isLoading}
                    >
                      {isLoading ? <Loader2 size={18} className="spinning" /> : <Check size={20} />}
                    </button>
                  </>
                )}
              </>
            )}

            {/* MARKER_DISTANCE stage */}
            {setupStage === STAGES.MARKER_DISTANCE && (
              <>
                <button
                  className="sidebar-btn primary"
                  onClick={handleDetectMarkers}
                  disabled={isLoading || !markerDistance}
                >
                  {isLoading ? <Loader2 size={18} className="spinning" /> : <Crosshair size={20} />}
                </button>
                <div className="sidebar-divider" />
                <button className="sidebar-btn" onClick={retryMarkerDetection}>
                  <RotateCcw size={16} />
                </button>
              </>
            )}

            {/* MARKERS_DETECTED stage - auto advances */}
            {setupStage === STAGES.MARKERS_DETECTED && (
              <button className="sidebar-btn success" disabled>
                <Check size={20} />
              </button>
            )}

            {/* READY stage */}
            {setupStage === STAGES.READY && (
              <button className="sidebar-btn record" onClick={() => setScreen('record')}>
                <Video size={20} />
              </button>
            )}
          </div>

          {/* Stage title label */}
          <div className="stage-label">
            <span className="stage-title">{STAGE_LABELS[setupStage]?.title}</span>
            <span className="stage-subtitle">{STAGE_LABELS[setupStage]?.subtitle}</span>
          </div>

          {/* Minimal bottom info */}
          <div className="bottom-info">
            {/* Color preview when sampling */}
            {previewColor && (setupStage === STAGES.MARKER_TAP || setupStage === STAGES.SMALL_BALL_TAP || setupStage === STAGES.BIG_BALL_TAP) && (
              <div className="color-chip" style={{ background: `rgba(${previewColor.r}, ${previewColor.g}, ${previewColor.b}, 0.3)` }}>
                <div style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  backgroundColor: previewColor.rgb,
                  border: '1px solid rgba(255,255,255,0.3)'
                }} />
                <span>{previewColor.r},{previewColor.g},{previewColor.b}</span>
              </div>
            )}

            {/* Distance input for marker distance stage */}
            {setupStage === STAGES.MARKER_DISTANCE && (
              <div className="distance-chip">
                <input
                  type="number"
                  value={markerDistance}
                  onChange={(e) => setMarkerDistance(e.target.value)}
                  placeholder="10"
                />
                <span>cm</span>
              </div>
            )}

            {/* Stage hints */}
            {setupStage === STAGES.MARKER_TAP && !capturedImage && (
              <span className="stage-hint">📷 Capture marker color</span>
            )}
            {setupStage === STAGES.MARKER_TAP && capturedImage && (
              <span className="stage-hint">👆 Drag box to marker</span>
            )}
            {setupStage === STAGES.SMALL_BALL_TAP && !capturedImage && (
              <span className="stage-hint">📷 Capture SMALL ball</span>
            )}
            {setupStage === STAGES.SMALL_BALL_TAP && capturedImage && (
              <span className="stage-hint">👆 Drag box to SMALL ball</span>
            )}
            {setupStage === STAGES.BIG_BALL_TAP && !capturedImage && (
              <span className="stage-hint">📷 Capture BIG ball</span>
            )}
            {setupStage === STAGES.BIG_BALL_TAP && capturedImage && (
              <span className="stage-hint">👆 Drag box to BIG ball</span>
            )}
            {setupStage === STAGES.MARKER_DISTANCE && (
              <span className="stage-hint">📏 Enter distance, tap detect</span>
            )}
            {setupStage === STAGES.MARKERS_DETECTED && (
              <span className="success-chip"><Check size={12} /> {setupResult}</span>
            )}
            {setupStage === STAGES.READY && (
              <span className="success-chip"><Check size={12} /> Ready to record</span>
            )}

            {/* Error display */}
            {error && <span className="error-chip">{error}</span>}
          </div>
        </>
      )}

      {/* Marker detection preview modal */}
      {markerPreview && markerPreview.annotated_image && (
        <div className="test-preview-modal">
          <div className={`test-preview-content ${markerPreview.size_warning ? 'warning' : 'success'}`}>
            <button className="close-btn" onClick={() => setMarkerPreview(null)}>
              <X size={20} />
            </button>
            <img
              src={`data:image/jpeg;base64,${markerPreview.annotated_image}`}
              alt="Marker detection preview"
              className="preview-image"
            />
            <div className="preview-status">
              {markerPreview.size_warning ? (
                <>
                  <AlertTriangle size={20} className="status-icon warning" />
                  <span>Size mismatch detected</span>
                </>
              ) : (
                <>
                  <Check size={20} className="status-icon success" />
                  <span>Markers detected!</span>
                </>
              )}
            </div>
            <div className="preview-details">
              <div className="detail-item">
                M1: {markerPreview.marker1?.area}px
              </div>
              <div className="detail-item">
                M2: {markerPreview.marker2?.area}px
              </div>
              <div className="detail-item">
                Ratio: {markerPreview.size_ratio?.toFixed(2)}
              </div>
              <div className="detail-item">
                Scale: {markerPreview.px_per_cm?.toFixed(1)} px/cm
              </div>
            </div>
            {markerPreview.size_warning && (
              <div className="warning-message">
                <AlertTriangle size={14} />
                {markerPreview.size_warning}
              </div>
            )}
            <button className="primary" onClick={acceptMarkerDetection}>
              {markerPreview.size_warning ? 'Use Anyway' : 'Continue'}
            </button>
            <button className="secondary" onClick={() => setMarkerPreview(null)}>
              Retry
            </button>
          </div>
        </div>
      )}

      {screen === 'record' && (
        <>
          {/* Recording sidebar */}
          <div className="recording-sidebar">
            <div className="recording-timer">{timer}</div>
            <div className="recording-stats">
              <strong>{frameCount}</strong> frames<br />
              <strong>{queueDepth}</strong> buffered
            </div>
            <div className={`network-indicator ${networkHealth}`}>
              {networkHealth === 'good' ? <Wifi size={16} /> : <WifiOff size={16} />}
            </div>
            <button
              className={`sidebar-btn ${isRecording ? 'record' : 'primary'}`}
              onClick={toggleRecording}
              style={{ width: 56, height: 56, minWidth: 56, maxWidth: 56 }}
            >
              {isRecording ? <Square size={24} /> : <Video size={24} />}
            </button>
          </div>

          {/* Recording bottom info */}
          <div className="recording-bottom-info">
            {isRecording && (
              <div className="recording-indicator">
                <div className="recording-dot" />
                <span>Recording</span>
              </div>
            )}
            {!isRecording && (
              <span className="stage-hint">Tap button to start recording</span>
            )}
          </div>
        </>
      )}

      {screen === 'processing' && (
        <div className="processing-overlay">
          <Loader2 size={48} className="spinning" style={{ color: 'var(--accent-primary)', marginBottom: 20 }} />
          <h2 style={{ color: 'rgba(255,255,255,0.9)', marginBottom: 16 }}>Uploading Frames</h2>
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
            {networkHealth === 'stalled' && <><WifiOff size={14} /> Stalled</>}
          </div>
          <button onClick={() => setScreen('camera')} className="secondary" style={{ marginTop: 20, maxWidth: 200 }}>Finish</button>
        </div>
      )}

      {/* Hidden canvas for capturing frames */}
      <canvas ref={captureCanvasRef} id="captureCanvas" style={{ display: 'none' }}></canvas>
    </div>
  );
}

export default App;
