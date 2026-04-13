import { useState, useRef, useEffect, useCallback } from 'react'
import { Upload, Target, Video, Play, RotateCcw, ChevronLeft, ChevronDown, ChevronUp, Settings, Crosshair, Image, FileVideo, Camera, Wifi, Copy, Trash2, Circle, Square, Hash, ChevronRight, Grid as GridIcon } from 'lucide-react'
import Grid from './lib/grid'

const API_BASE = '/api'

function api(endpoint, options = {}) {
  return fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  }).then(r => r.json())
}

// ============================================
// LOG PANEL COMPONENT
// ============================================
function LogPanel({ logs, onClear }) {
  const [isOpen, setIsOpen] = useState(true)
  const logContainerRef = useRef(null)

  useEffect(() => {
    if (logContainerRef.current && isOpen) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs, isOpen])

  const copyLogs = () => {
    const text = logs.map(l => `${l.timestamp.toLocaleTimeString()} [${l.type.toUpperCase()}] ${l.message}`).join('\n')
    navigator.clipboard.writeText(text)
  }

  const typeColors = {
    info: '#4FC3F7',
    success: '#66BB6A',
    warning: '#FFA726',
    error: '#EF5350',
    debug: '#888'
  }

  const typeIcons = {
    info: 'i',
    success: '✓',
    warning: '⚠',
    error: '✕',
    debug: '•'
  }

  return (
    <div className="log-panel">
      <div className="log-header" onClick={() => setIsOpen(!isOpen)}>
        <span className="log-toggle">
          {isOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          Debug Log
        </span>
        <span className="log-count">{logs.length} msgs</span>
        <div className="log-actions" onClick={e => e.stopPropagation()}>
          <button className="log-btn" onClick={copyLogs} title="Copy logs">
            <Copy size={14} />
          </button>
          <button className="log-btn" onClick={onClear} title="Clear logs">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {isOpen && (
        <div className="log-container" ref={logContainerRef}>
          {logs.length === 0 ? (
            <div className="log-empty">No logs yet</div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="log-entry">
                <span className="log-time">{log.timestamp.toLocaleTimeString()}</span>
                <span className="log-type" style={{ color: typeColors[log.type] }}>
                  [{typeIcons[log.type]}]
                </span>
                <span className="log-message">{log.message}</span>
                {log.data && (
                  <pre className="log-data">{JSON.stringify(log.data, null, 2)}</pre>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ============================================
// GALLERY VIEW COMPONENT
// ============================================
function GalleryView({ gallery, apiBase }) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [filterDetected, setFilterDetected] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(2) // FPS: 1 or 2
  const thumbnailsRef = useRef(null)
  const playIntervalRef = useRef(null)

  if (!gallery || gallery.length === 0) {
    return (
      <div className="gallery-empty">
        <p>No gallery frames available</p>
      </div>
    )
  }

  // Get detected frames only for playback
  const detectedFrames = gallery.filter(g => g.detected)
  const filteredGallery = filterDetected ? detectedFrames : gallery
  const currentFrame = filteredGallery[selectedIndex] || filteredGallery[0]

  const goToPrev = () => {
    setIsPlaying(false)
    setSelectedIndex(prev => Math.max(0, prev - 1))
  }

  const goToNext = () => {
    setIsPlaying(false)
    setSelectedIndex(prev => Math.min(filteredGallery.length - 1, prev + 1))
  }

  const togglePlayback = () => {
    if (!isPlaying) {
      // Start playback - auto-enable detected-only filter
      setFilterDetected(true)
      setSelectedIndex(0)
    }
    setIsPlaying(prev => !prev)
  }

  // Playback effect
  useEffect(() => {
    if (isPlaying && detectedFrames.length > 0) {
      const interval = 1000 / playbackSpeed
      playIntervalRef.current = setInterval(() => {
        setSelectedIndex(prev => {
          const next = prev + 1
          if (next >= detectedFrames.length) {
            setIsPlaying(false)
            return 0 // Loop back to start
          }
          return next
        })
      }, interval)
    }

    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current)
      }
    }
  }, [isPlaying, playbackSpeed, detectedFrames.length])

  // Scroll thumbnail into view
  useEffect(() => {
    if (thumbnailsRef.current && thumbnailsRef.current.children[selectedIndex]) {
      thumbnailsRef.current.children[selectedIndex].scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center'
      })
    }
  }, [selectedIndex])

  // Reset index when filter changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [filterDetected])

  return (
    <div className="gallery-view">
      {/* Playback controls */}
      <div className="gallery-playback">
        <button
          className={`btn playback-btn ${isPlaying ? 'playing' : ''}`}
          onClick={togglePlayback}
          disabled={detectedFrames.length === 0}
        >
          {isPlaying ? (
            <>
              <Square size={16} fill="currentColor" />
              Stop
            </>
          ) : (
            <>
              <Play size={16} fill="currentColor" />
              Play Detections
            </>
          )}
        </button>
        <div className="speed-selector">
          <span>Speed:</span>
          {[1, 2, 3, 4, 5].map(fps => (
            <button
              key={fps}
              className={playbackSpeed === fps ? 'active' : ''}
              onClick={() => setPlaybackSpeed(fps)}
            >
              {fps}
            </button>
          ))}
          <span className="fps-label">FPS</span>
        </div>
        <span className="detected-count">
          {detectedFrames.length} detected frames
        </span>
      </div>

      {/* Main image */}
      <div className="gallery-main">
        <button className="gallery-nav gallery-prev" onClick={goToPrev} disabled={selectedIndex === 0}>
          <ChevronLeft size={24} />
        </button>
        <div className="gallery-image-container">
          <img
            src={`${apiBase}${currentFrame.url}`}
            alt={`Frame ${currentFrame.frame_index}`}
            className="gallery-main-image"
          />
          <div className="gallery-image-info">
            <span className={`detection-badge ${currentFrame.detected ? 'detected' : 'not-detected'}`}>
              {currentFrame.detected ? 'DETECTED' : 'NO DETECTION'}
            </span>
            <span className="frame-number">Frame {currentFrame.frame_index}</span>
          </div>
          {isPlaying && (
            <div className="playback-indicator">
              <div className="play-pulse" />
              Playing
            </div>
          )}
        </div>
        <button className="gallery-nav gallery-next" onClick={goToNext} disabled={selectedIndex === filteredGallery.length - 1}>
          <ChevronRight size={24} />
        </button>
      </div>

      {/* Controls */}
      <div className="gallery-controls">
        <span className="gallery-counter">
          {selectedIndex + 1} / {filteredGallery.length} frames
        </span>
        <label className="gallery-filter">
          <input
            type="checkbox"
            checked={filterDetected}
            onChange={(e) => {
              setFilterDetected(e.target.checked)
              setIsPlaying(false)
            }}
          />
          Show detected only
        </label>
      </div>

      {/* Thumbnails */}
      <div className="gallery-thumbnails" ref={thumbnailsRef}>
        {filteredGallery.map((frame, idx) => (
          <button
            key={frame.frame_index}
            className={`gallery-thumb ${idx === selectedIndex ? 'active' : ''} ${frame.detected ? 'detected' : ''}`}
            onClick={() => {
              setSelectedIndex(idx)
              setIsPlaying(false)
            }}
          >
            <img
              src={`${apiBase}${frame.url}`}
              alt={`Frame ${frame.frame_index}`}
              loading="lazy"
            />
            <span className="thumb-index">{frame.frame_index}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ============================================
// COLOR SAMPLER - Click to position crosshair
// ============================================
function useColorSampler(imageRef, canvasRef) {
  const [position, setPosition] = useState(null) // { x, y } percentage
  const [boxSize, setBoxSize] = useState(50)
  const [previewColor, setPreviewColor] = useState(null)

  const increaseBoxSize = () => setBoxSize(prev => Math.min(150, prev + 10))
  const decreaseBoxSize = () => setBoxSize(prev => Math.max(10, prev - 10))

  // Sample color at current position
  useEffect(() => {
    if (!position || !imageRef?.current || !canvasRef?.current) return

    const img = imageRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const rect = img.getBoundingClientRect()

    const imgElement = new window.Image()
    imgElement.crossOrigin = 'anonymous'
    imgElement.onload = () => {
      canvas.width = imgElement.width
      canvas.height = imgElement.height
      ctx.drawImage(imgElement, 0, 0)

      const scaleX = imgElement.width / rect.width
      const scaleY = imgElement.height / rect.height
      const x = (position.x / 100) * rect.width * scaleX
      const y = (position.y / 100) * rect.height * scaleY

      const halfBox = Math.floor((boxSize * scaleX) / 2)
      const startX = Math.max(0, Math.floor(x) - halfBox)
      const startY = Math.max(0, Math.floor(y) - halfBox)
      const sampleSize = Math.min(boxSize, Math.floor(boxSize * scaleX))

      try {
        const imageData = ctx.getImageData(startX, startY, sampleSize, sampleSize)
        let r = 0, g = 0, b = 0, count = 0
        for (let i = 0; i < imageData.data.length; i += 4) {
          r += imageData.data[i]
          g += imageData.data[i + 1]
          b += imageData.data[i + 2]
          count++
        }
        setPreviewColor({
          r: Math.round(r / count),
          g: Math.round(g / count),
          b: Math.round(b / count)
        })
      } catch (e) {
        console.error('Color sampling failed:', e)
      }
    }
    imgElement.src = img.src
  }, [position, boxSize, imageRef, canvasRef])

  const handleImageClick = (e) => {
    const rect = e.target.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setPosition({ x, y })
  }

  const reset = () => {
    setPosition(null)
    setPreviewColor(null)
  }

  return {
    position,
    boxSize,
    previewColor,
    increaseBoxSize,
    decreaseBoxSize,
    handleImageClick,
    reset
  }
}

// ============================================
// IP CAMERA STREAM COMPONENT
// ============================================
function IPCameraStream({ streamUrl, onFrame, isRecording }) {
  const imgRef = useRef(null)
  const [error, setError] = useState(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!streamUrl) {
      setConnected(false)
      return
    }
    setError(null)
    setConnected(false)
  }, [streamUrl])

  const handleLoad = () => {
    setConnected(true)
    setError(null)
  }

  const handleError = () => {
    setConnected(false)
    setError('Failed to connect to camera stream')
  }

  return (
    <div className="video-container">
      {streamUrl ? (
        <>
          <img
            ref={imgRef}
            src={streamUrl}
            alt="IP Camera Stream"
            onLoad={handleLoad}
            onError={handleError}
            style={{ display: connected ? 'block' : 'none' }}
          />
          {!connected && !error && (
            <div className="video-overlay">Connecting to camera...</div>
          )}
          {error && (
            <div className="video-overlay" style={{ color: '#EF5350' }}>{error}</div>
          )}
          {isRecording && connected && (
            <div className="recording-indicator">
              <div className="rec-dot" />
              <span>REC</span>
            </div>
          )}
        </>
      ) : (
        <div className="video-overlay">
          Enter IP camera URL above to connect
        </div>
      )}
    </div>
  )
}

// ============================================
// MAIN APP COMPONENT
// ============================================
export default function App() {
  const [screen, setScreen] = useState('setup') // 'setup' or 'results'
  const [inputMode, setInputMode] = useState('upload') // 'upload' or 'stream'

  // Session
  const [sessionCode, setSessionCode] = useState(null)

  // IP Camera
  const [cameraUrl, setCameraUrl] = useState(() => localStorage.getItem('cameraUrl') || '')
  const [isStreamConnected, setIsStreamConnected] = useState(false)

  // Calibration image
  const [calibrationImage, setCalibrationImage] = useState(null)
  const [calibrationImageSize, setCalibrationImageSize] = useState(null)

  // Calibration state
  const [markerColor, setMarkerColor] = useState(null)
  const [markerDistance, setMarkerDistance] = useState(10)
  const [calibrationResult, setCalibrationResult] = useState(null)
  const [smallBallColor, setSmallBallColor] = useState(null)
  const [bigBallColor, setBigBallColor] = useState(null)

  // Sampling
  const [samplingMode, setSamplingMode] = useState(null) // 'marker', 'small', 'big'

  // Annotated image from marker detection
  const [annotatedImage, setAnnotatedImage] = useState(null)

  // Video upload
  const [videoFile, setVideoFile] = useState(null)
  const [videoName, setVideoName] = useState('')

  // Recording from stream
  const [isRecording, setIsRecording] = useState(false)
  const [recordedFrames, setRecordedFrames] = useState([])
  const recordingIntervalRef = useRef(null)

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [debugFrame, setDebugFrame] = useState(null)  // Live detection preview

  // Results
  const [currentRun, setCurrentRun] = useState(null)
  const [allRuns, setAllRuns] = useState([])
  const [gridMode, setGridMode] = useState('both')

  // Logs
  const [logs, setLogs] = useState([])

  // Refs
  const fileInputRef = useRef(null)
  const videoInputRef = useRef(null)
  const canvasRef = useRef(null)
  const gridCanvasRef = useRef(null)
  const gridInstanceRef = useRef(null)
  const calibrationImageRef = useRef(null)
  const streamImgRef = useRef(null)

  // Color sampler hook
  const sampler = useColorSampler(calibrationImageRef, canvasRef)

  // Add log helper
  const addLog = useCallback((type, message, data = null) => {
    setLogs(prev => [...prev, {
      id: Date.now() + Math.random(),
      timestamp: new Date(),
      type,
      message,
      data
    }])
  }, [])

  const clearLogs = () => setLogs([])

  // Create session on mount
  useEffect(() => {
    createSession()
    loadAllRuns()
    addLog('info', 'App initialized')
  }, [addLog])

  const createSession = async () => {
    try {
      const data = await api('/session/new', { method: 'POST' })
      if (data.session_code) {
        setSessionCode(data.session_code)
        addLog('success', `Session created: ${data.session_code}`)
      }
    } catch (err) {
      addLog('error', 'Session creation failed', { error: err.message })
    }
  }

  // Save camera URL to localStorage
  useEffect(() => {
    localStorage.setItem('cameraUrl', cameraUrl)
  }, [cameraUrl])

  // Handle calibration image upload
  const handleImageUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    addLog('info', `Loading calibration image: ${file.name}`)

    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new window.Image()
      img.onload = () => {
        setCalibrationImageSize({ width: img.width, height: img.height })
        setCalibrationImage(event.target.result)
        setMarkerColor(null)
        setCalibrationResult(null)
        setSmallBallColor(null)
        setBigBallColor(null)
        addLog('success', `Image loaded: ${img.width}x${img.height}`)
      }
      img.src = event.target.result
    }
    reader.readAsDataURL(file)
  }

  // Handle video upload
  const handleVideoUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setVideoFile(file)
    setVideoName(file.name)
    addLog('info', `Video selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`)
  }

  // Start sampling mode
  const startSampling = (mode) => {
    setSamplingMode(mode)
    sampler.reset()
    addLog('info', `Started sampling: ${mode} - click on image to position crosshair`)
  }

  // Cancel sampling mode
  const cancelSampling = () => {
    setSamplingMode(null)
    sampler.reset()
  }

  // Confirm the sampled color
  const confirmSampledColor = async () => {
    const color = sampler.previewColor
    if (!color) return

    addLog('success', `Color confirmed for ${samplingMode}`, { rgb: color })

    if (samplingMode === 'marker') {
      setMarkerColor(color)
    } else if (samplingMode === 'small') {
      setSmallBallColor(color)
      if (sessionCode) {
        await api('/setup', {
          method: 'POST',
          headers: { 'X-Session-Code': sessionCode },
          body: JSON.stringify({ small_ball_color: color })
        })
        addLog('info', 'Small ball color sent to backend')
      }
    } else if (samplingMode === 'big') {
      setBigBallColor(color)
      if (sessionCode) {
        await api('/setup', {
          method: 'POST',
          headers: { 'X-Session-Code': sessionCode },
          body: JSON.stringify({ big_ball_color: color })
        })
        addLog('info', 'Big ball color sent to backend')
      }
    }

    setSamplingMode(null)
    sampler.reset()
  }

  // Handle image click for sampling
  const handleImageClick = (e) => {
    if (!samplingMode) return
    sampler.handleImageClick(e)
  }

  // Detect markers
  const detectMarkers = async () => {
    if (!markerColor || !sessionCode || !calibrationImage) return

    addLog('info', 'Detecting markers...', { markerColor, distance: markerDistance })

    const base64 = calibrationImage.split(',')[1]

    try {
      const result = await api('/calibrate', {
        method: 'POST',
        headers: { 'X-Session-Code': sessionCode },
        body: JSON.stringify({
          marker_color: markerColor,
          marker_distance_cm: markerDistance,
          image: base64
        })
      })

      if (result.ok) {
        setCalibrationResult(result)
        // Show annotated image if returned
        if (result.annotated_image) {
          setAnnotatedImage(`data:image/jpeg;base64,${result.annotated_image}`)
        }
        addLog('success', `Markers detected! Scale: ${result.px_per_cm?.toFixed(2)} px/cm`, {
          marker1: result.marker1,
          marker2: result.marker2,
          px_per_cm: result.px_per_cm
        })
        if (result.size_warning) {
          addLog('warning', result.size_warning)
        }
      } else {
        setAnnotatedImage(null)
        addLog('error', 'Marker detection failed', { error: result.error })
        alert(result.error || 'Marker detection failed')
      }
    } catch (err) {
      addLog('error', 'Marker detection error', { error: err.message })
      alert('Marker detection failed: ' + err.message)
    }
  }

  // Capture frame from stream
  const captureFrameFromStream = () => {
    if (!streamImgRef.current) return null
    const canvas = document.createElement('canvas')
    const img = streamImgRef.current
    canvas.width = img.naturalWidth || img.width
    canvas.height = img.naturalHeight || img.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.85)
  }

  // Start recording from stream
  const startRecording = () => {
    if (!isStreamConnected) {
      addLog('error', 'Camera not connected')
      return
    }

    setIsRecording(true)
    setRecordedFrames([])
    addLog('info', 'Recording started')

    // Capture frames at ~15 FPS
    let frameCount = 0
    recordingIntervalRef.current = setInterval(() => {
      const frame = captureFrameFromStream()
      if (frame) {
        setRecordedFrames(prev => [...prev, frame])
        frameCount++
        if (frameCount % 15 === 0) {
          addLog('debug', `Captured ${frameCount} frames`)
        }
      }
    }, 66) // ~15 FPS
  }

  // Stop recording and process
  const stopRecording = async () => {
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current)
      recordingIntervalRef.current = null
    }
    setIsRecording(false)

    addLog('info', `Recording stopped. ${recordedFrames.length} frames captured`)

    if (recordedFrames.length < 10) {
      addLog('error', 'Not enough frames recorded')
      return
    }

    // Process recorded frames
    await processFrames(recordedFrames)
  }

  // Process frames (either from recording or extracted from video)
  const processFrames = async (frames) => {
    if (!sessionCode || !calibrationResult || !smallBallColor) {
      addLog('error', 'Missing calibration or ball color')
      return
    }

    setIsProcessing(true)
    setProgress(0)
    setProgressLabel('Processing frames...')
    addLog('info', `Processing ${frames.length} frames...`)

    try {
      // Send frames to backend for processing
      const response = await fetch(`${API_BASE}/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Code': sessionCode
        },
        body: JSON.stringify({
          frames: frames.map(f => f.split(',')[1]) // Remove data URL prefix
        })
      })

      const result = await response.json()

      if (result.ok) {
        addLog('success', 'Processing complete', {
          winning_curve: result.winning_curve,
          detected_frames: result.stats?.detected_frames
        })
        setCurrentRun(result)
        setScreen('results')
        loadAllRuns()
        setRecordedFrames([])
        createSession()
      } else {
        throw new Error(result.error || 'Processing failed')
      }
    } catch (err) {
      addLog('error', 'Processing failed', { error: err.message })
      alert('Processing failed: ' + err.message)
    } finally {
      setIsProcessing(false)
      setProgress(0)
    }
  }

  // Process video (upload mode)
  const processVideo = async () => {
    if (!videoFile || !sessionCode || !calibrationResult || !smallBallColor) return

    setIsProcessing(true)
    setProgress(0)
    setProgressLabel('Uploading video...')
    addLog('info', `Uploading video: ${videoFile.name}`)

    try {
      const formData = new FormData()
      formData.append('video', videoFile)

      const uploadResponse = await fetch(`${API_BASE}/upload-video`, {
        method: 'POST',
        headers: { 'X-Session-Code': sessionCode },
        body: formData
      })

      const uploadResult = await uploadResponse.json()

      if (!uploadResult.ok) {
        throw new Error(uploadResult.error || 'Upload failed')
      }

      addLog('success', `Video uploaded. ${uploadResult.frame_count} frames extracted`)
      setProgressLabel('Processing video...')

      // Poll for status
      const pollInterval = setInterval(async () => {
        try {
          const status = await api('/status', {
            headers: { 'X-Session-Code': sessionCode }
          })

          if (status.status === 'processing') {
            setProgress(status.progress || 0)
            setProgressLabel(status.progress_label || 'Processing...')
            // Update debug frame for live detection preview
            if (status.debug_frame) {
              setDebugFrame(`data:image/jpeg;base64,${status.debug_frame}`)
            }
            addLog('debug', `Progress: ${(status.progress * 100).toFixed(0)}% - ${status.progress_label}`)
          } else if (status.status === 'done') {
            clearInterval(pollInterval)
            setIsProcessing(false)
            setProgress(1)
            setDebugFrame(null)  // Clear debug frame

            if (status.run_id) {
              const runData = await api(`/runs/${status.run_id}`)
              setCurrentRun(runData)
              setScreen('results')
              loadAllRuns()
              setVideoFile(null)
              setVideoName('')
              createSession()
              addLog('success', 'Processing complete!', {
                run_id: status.run_id,
                winning_curve: runData.winning_curve
              })
            }
          } else if (status.status === 'error') {
            clearInterval(pollInterval)
            setIsProcessing(false)
            setDebugFrame(null)  // Clear debug frame
            addLog('error', 'Processing failed', { error: status.error })
            alert('Processing failed: ' + (status.error || 'Unknown error'))
          }
        } catch (err) {
          addLog('error', 'Status poll error', { error: err.message })
        }
      }, 500)

    } catch (err) {
      setIsProcessing(false)
      addLog('error', 'Video upload failed', { error: err.message })
      alert('Failed to process video: ' + err.message)
    }
  }

  // Load past runs
  const loadAllRuns = async () => {
    try {
      const data = await api('/runs')
      setAllRuns(data.runs || [])
      addLog('debug', `Loaded ${data.runs?.length || 0} past runs`)
    } catch (err) {
      addLog('error', 'Failed to load runs', { error: err.message })
    }
  }

  // Initialize grid
  useEffect(() => {
    if (screen === 'results' && gridCanvasRef.current && !gridInstanceRef.current) {
      gridInstanceRef.current = new Grid(gridCanvasRef.current)
    }
    if (gridInstanceRef.current && currentRun) {
      gridInstanceRef.current.setRuns([currentRun])
      gridInstanceRef.current.setMode(gridMode)
    }
  }, [screen, currentRun, gridMode])

  const colorToHex = (c) => c ? `rgb(${c.r}, ${c.g}, ${c.b})` : '#333'
  const colorToHexString = (c) => c ? `#${c.r.toString(16).padStart(2, '0')}${c.g.toString(16).padStart(2, '0')}${c.b.toString(16).padStart(2, '0')}` : ''

  // Parse hex color string to RGB object
  const parseHexColor = (hex) => {
    const match = hex.match(/^#?([a-fA-F0-9]{6})$/)
    if (!match) return null
    const val = match[1]
    return {
      r: parseInt(val.substring(0, 2), 16),
      g: parseInt(val.substring(2, 4), 16),
      b: parseInt(val.substring(4, 6), 16)
    }
  }

  // Apply hex color to a specific target
  const applyHexColor = async (hex, target) => {
    const color = parseHexColor(hex)
    if (!color) {
      addLog('error', `Invalid hex color: ${hex}`)
      return
    }
    addLog('success', `Hex color applied for ${target}`, { hex, rgb: color })

    if (target === 'marker') {
      setMarkerColor(color)
    } else if (target === 'small') {
      setSmallBallColor(color)
      if (sessionCode) {
        await api('/setup', {
          method: 'POST',
          headers: { 'X-Session-Code': sessionCode },
          body: JSON.stringify({ small_ball_color: color })
        })
      }
    } else if (target === 'big') {
      setBigBallColor(color)
      if (sessionCode) {
        await api('/setup', {
          method: 'POST',
          headers: { 'X-Session-Code': sessionCode },
          body: JSON.stringify({ big_ball_color: color })
        })
      }
    }
  }

  const isCalibrated = calibrationResult !== null
  const isSetupComplete = isCalibrated && smallBallColor !== null

  // RESULTS SCREEN
  if (screen === 'results') {
    return (
      <div className="app">
        <div className="results-header">
          <button className="btn btn-secondary" onClick={() => setScreen('setup')}>
            <ChevronLeft size={18} />
            Back
          </button>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Results</h1>
          <button className="btn btn-secondary" onClick={() => gridInstanceRef.current?.resetView()}>
            <RotateCcw size={16} />
            Reset
          </button>
        </div>

        {/* Side by side: Detection Frame + Trajectory Plot */}
        <div className="results-row">
          {/* Video Frame Visualization */}
          {currentRun?.visualization_url && (
            <div className="card results-card-half">
              <div className="card-header"><h2>Detection Frame</h2></div>
              <div className="visualization-container-small">
                <img
                  src={`${API_BASE}${currentRun.visualization_url}`}
                  alt="Detection visualization"
                  className="visualization-image"
                />
              </div>
              {currentRun?.equation && (
                <div className="equation-display-compact">
                  <span className="curve-type">{currentRun.equation.type}</span>
                  <p className="equation">{currentRun.equation.display}</p>
                </div>
              )}
            </div>
          )}

          {/* Interactive Grid Visualization */}
          <div className="card results-card-half">
            <div className="card-header"><h2>Trajectory Plot</h2></div>
            <div className="grid-controls">
              {['both', 'dots', 'curve'].map(m => (
                <button
                  key={m}
                  className={gridMode === m ? 'active' : ''}
                  onClick={() => { setGridMode(m); gridInstanceRef.current?.setMode(m) }}
                >
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
            <div className="grid-container-small">
              <canvas ref={gridCanvasRef} />
            </div>
          </div>
        </div>

        {/* Gallery of all processed frames */}
        {currentRun?.gallery && currentRun.gallery.length > 0 && (
          <div className="card">
            <div className="card-header">
              <GridIcon className="icon" size={20} />
              <h2>Detection Gallery</h2>
              <span className="gallery-badge">{currentRun.gallery.length} frames</span>
            </div>
            <GalleryView gallery={currentRun.gallery} apiBase={API_BASE} />
          </div>
        )}

        {currentRun?.stats && (
          <div className="card">
            <div className="card-header"><h2>Statistics</h2></div>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-label">Total Frames</span>
                <span className="stat-value">{currentRun.stats.total_frames}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Detected</span>
                <span className="stat-value">{currentRun.stats.detected_frames}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Selected</span>
                <span className="stat-value">{currentRun.stats.selected_frames}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Scale</span>
                <span className="stat-value">{currentRun.stats.px_per_cm} px/cm</span>
              </div>
            </div>
          </div>
        )}

        {allRuns.length > 0 && (
          <div className="card">
            <div className="card-header"><h2>Past Runs</h2></div>
            <div className="past-runs">
              {allRuns.map((run) => (
                <button
                  key={run.run_id}
                  className={`run-chip ${currentRun?.run_id === run.run_id ? 'active' : ''}`}
                  onClick={async () => {
                    const runData = await api(`/runs/${run.run_id}`)
                    setCurrentRun(runData)
                    gridInstanceRef.current?.setRuns([runData])
                  }}
                >
                  {new Date(run.timestamp).toLocaleDateString()} {new Date(run.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </button>
              ))}
            </div>
          </div>
        )}

        <LogPanel logs={logs} onClear={clearLogs} />
      </div>
    )
  }

  // SETUP SCREEN
  return (
    <div className="app">
      <header className="header">
        <h1>CosmosCurves</h1>
        <p>Ball Trajectory Tracker</p>
      </header>

      {/* Input Mode Selector */}
      <div className="card">
        <div className="card-header">
          <Camera className="icon" size={20} />
          <h2>Input Mode</h2>
        </div>
        <div className="mode-selector">
          <button
            className={`mode-btn ${inputMode === 'upload' ? 'active' : ''}`}
            onClick={() => setInputMode('upload')}
          >
            <Upload size={24} />
            <span>Upload Files</span>
            <small>Photo + Video upload</small>
          </button>
          <button
            className={`mode-btn ${inputMode === 'stream' ? 'active' : ''}`}
            onClick={() => setInputMode('stream')}
          >
            <Wifi size={24} />
            <span>IP Camera</span>
            <small>Live stream capture</small>
          </button>
        </div>
      </div>

      {/* IP Camera Mode */}
      {inputMode === 'stream' && (
        <div className="card">
          <div className="card-header">
            <Wifi className="icon" size={20} />
            <h2>IP Camera Connection</h2>
          </div>
          <p className="card-description">
            Enter the MJPEG stream URL from your IP camera app (e.g., IP Webcam, DroidCam)
          </p>
          <div className="input-group">
            <input
              type="text"
              placeholder="http://192.168.1.100:8080/video"
              value={cameraUrl}
              onChange={(e) => setCameraUrl(e.target.value)}
            />
            <button
              className="btn btn-primary"
              onClick={() => {
                setIsStreamConnected(false)
                setTimeout(() => setIsStreamConnected(true), 100)
                addLog('info', `Connecting to camera: ${cameraUrl}`)
              }}
            >
              Connect
            </button>
          </div>

          {cameraUrl && (
            <div className="video-container">
              <img
                ref={streamImgRef}
                src={cameraUrl}
                alt="IP Camera Stream"
                onLoad={() => {
                  setIsStreamConnected(true)
                  addLog('success', 'Camera connected')
                }}
                onError={() => {
                  setIsStreamConnected(false)
                  addLog('error', 'Camera connection failed')
                }}
                style={{ display: isStreamConnected ? 'block' : 'none' }}
              />
              {!isStreamConnected && (
                <div className="video-overlay">
                  {cameraUrl ? 'Connecting to camera...' : 'Enter camera URL above'}
                </div>
              )}
              {isRecording && (
                <div className="recording-indicator">
                  <div className="rec-dot" />
                  <span>REC</span>
                  <span className="frame-count">{recordedFrames.length} frames</span>
                </div>
              )}
            </div>
          )}

          {isStreamConnected && !calibrationImage && (
            <button
              className="btn btn-primary"
              onClick={() => {
                const frame = captureFrameFromStream()
                if (frame) {
                  const img = new window.Image()
                  img.onload = () => {
                    setCalibrationImageSize({ width: img.width, height: img.height })
                    setCalibrationImage(frame)
                    addLog('success', 'Captured calibration frame')
                  }
                  img.src = frame
                }
              }}
              style={{ marginTop: 12 }}
            >
              <Camera size={18} />
              Capture Calibration Frame
            </button>
          )}
        </div>
      )}

      {/* Upload Mode - Calibration Photo */}
      {inputMode === 'upload' && (
        <div className="card">
          <div className="card-header">
            <Image className="icon" size={20} />
            <h2>Step 1: Calibration Photo</h2>
          </div>

          <p className="card-description">
            Take a photo of your setup showing both calibration markers and the balls.
          </p>

          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            onChange={handleImageUpload}
            style={{ display: 'none' }}
          />

          {!calibrationImage ? (
            <button className="btn btn-primary upload-btn" onClick={() => fileInputRef.current?.click()}>
              <Upload size={20} />
              Upload Photo
            </button>
          ) : (
            <>
              <div className="calibration-image-container">
                <img
                  ref={calibrationImageRef}
                  src={annotatedImage || calibrationImage}
                  alt="Calibration"
                  onClick={handleImageClick}
                  style={{ cursor: samplingMode ? 'crosshair' : 'default' }}
                  className="calibration-image"
                />
                {/* Crosshair overlay when sampling */}
                {samplingMode && sampler.position && (
                  <div
                    className="crosshair-overlay"
                    style={{ left: `${sampler.position.x}%`, top: `${sampler.position.y}%` }}
                  >
                    <div className="crosshair-v" />
                    <div className="crosshair-h" />
                    <div className="crosshair-box" style={{ width: sampler.boxSize, height: sampler.boxSize }} />
                  </div>
                )}
              </div>

              {/* Sampling controls below image */}
              {samplingMode && (
                <div className="sampling-controls">
                  <div className="sampling-header">
                    <span>Sampling: <strong>{samplingMode}</strong></span>
                    <span className="sampling-hint">Click on image to position crosshair</span>
                  </div>
                  <div className="sampling-row">
                    <div className="size-controls">
                      <button className="size-btn" onClick={sampler.decreaseBoxSize}>-</button>
                      <span>{sampler.boxSize}px</span>
                      <button className="size-btn" onClick={sampler.increaseBoxSize}>+</button>
                    </div>
                    {sampler.previewColor && (
                      <div className="color-preview-inline">
                        <div
                          className="preview-swatch-inline"
                          style={{ backgroundColor: `rgb(${sampler.previewColor.r}, ${sampler.previewColor.g}, ${sampler.previewColor.b})` }}
                        />
                        <span>RGB({sampler.previewColor.r}, {sampler.previewColor.g}, {sampler.previewColor.b})</span>
                      </div>
                    )}
                  </div>
                  <div className="sampling-actions-row">
                    <button className="btn btn-secondary" onClick={cancelSampling}>Cancel</button>
                    <button
                      className="btn btn-primary"
                      onClick={confirmSampledColor}
                      disabled={!sampler.previewColor}
                    >
                      Confirm Color
                    </button>
                  </div>
                </div>
              )}

              {!samplingMode && (
                <button className="btn btn-secondary change-image-btn" onClick={() => fileInputRef.current?.click()}>
                  Change Photo
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Show calibration image for stream mode too */}
      {inputMode === 'stream' && calibrationImage && (
        <div className="card">
          <div className="card-header">
            <Image className="icon" size={20} />
            <h2>Calibration Frame</h2>
          </div>
          <>
            <div className="calibration-image-container">
              <img
                ref={calibrationImageRef}
                src={annotatedImage || calibrationImage}
                alt="Calibration"
                onClick={handleImageClick}
                style={{ cursor: samplingMode ? 'crosshair' : 'default' }}
                className="calibration-image"
              />
              {/* Crosshair overlay when sampling */}
              {samplingMode && sampler.position && (
                <div
                  className="crosshair-overlay"
                  style={{ left: `${sampler.position.x}%`, top: `${sampler.position.y}%` }}
                >
                  <div className="crosshair-v" />
                  <div className="crosshair-h" />
                  <div className="crosshair-box" style={{ width: sampler.boxSize, height: sampler.boxSize }} />
                </div>
              )}
            </div>

            {/* Sampling controls below image */}
            {samplingMode && (
              <div className="sampling-controls">
                <div className="sampling-header">
                  <span>Sampling: <strong>{samplingMode}</strong></span>
                  <span className="sampling-hint">Click on image to position crosshair</span>
                </div>
                <div className="sampling-row">
                  <div className="size-controls">
                    <button className="size-btn" onClick={sampler.decreaseBoxSize}>-</button>
                    <span>{sampler.boxSize}px</span>
                    <button className="size-btn" onClick={sampler.increaseBoxSize}>+</button>
                  </div>
                  {sampler.previewColor && (
                    <div className="color-preview-inline">
                      <div
                        className="preview-swatch-inline"
                        style={{ backgroundColor: `rgb(${sampler.previewColor.r}, ${sampler.previewColor.g}, ${sampler.previewColor.b})` }}
                      />
                      <span>RGB({sampler.previewColor.r}, {sampler.previewColor.g}, {sampler.previewColor.b})</span>
                    </div>
                  )}
                </div>
                <div className="sampling-actions-row">
                  <button className="btn btn-secondary" onClick={cancelSampling}>Cancel</button>
                  <button
                    className="btn btn-primary"
                    onClick={confirmSampledColor}
                    disabled={!sampler.previewColor}
                  >
                    Confirm Color
                  </button>
                </div>
              </div>
            )}

            {!samplingMode && (
              <button
                className="btn btn-secondary change-image-btn"
                onClick={() => {
                  setCalibrationImage(null)
                  setCalibrationResult(null)
                  setAnnotatedImage(null)
                  setMarkerColor(null)
                  setSmallBallColor(null)
                  setBigBallColor(null)
                }}
              >
                Recapture
              </button>
            )}
          </>
        </div>
      )}

      {/* Step 2: Calibration */}
      {calibrationImage && (
        <div className="card">
          <div className="card-header">
            <Target className="icon" size={20} />
            <h2>Step 2: Calibrate</h2>
          </div>

          <div className="calibration-row">
            <label>Marker Color:</label>
            <div className="color-swatch" style={{ backgroundColor: colorToHex(markerColor) }} />
            <button
              className={`btn ${samplingMode === 'marker' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => startSampling('marker')}
            >
              <Crosshair size={16} />
              Sample
            </button>
            <span className="color-divider">or</span>
            <div className="hex-input-group">
              <Hash size={14} />
              <input
                type="text"
                placeholder="a21723"
                maxLength={7}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    applyHexColor(e.target.value, 'marker')
                    e.target.value = ''
                  }
                }}
                onBlur={(e) => {
                  if (e.target.value) {
                    applyHexColor(e.target.value, 'marker')
                    e.target.value = ''
                  }
                }}
              />
            </div>
            {markerColor && <span className="status-badge success">Set</span>}
          </div>

          <div className="calibration-row">
            <label>Marker Distance:</label>
            <input
              type="number"
              value={markerDistance}
              onChange={(e) => setMarkerDistance(Number(e.target.value))}
              min={1}
              max={100}
            />
            <span style={{ color: '#888', fontSize: 14 }}>cm</span>
          </div>

          <div className="calibration-row">
            <button
              className="btn btn-primary"
              onClick={detectMarkers}
              disabled={!markerColor}
            >
              Detect Markers
            </button>
            {calibrationResult && (
              <span className="status-badge success">
                Scale: {calibrationResult.px_per_cm?.toFixed(1)} px/cm
              </span>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Ball Colors */}
      {isCalibrated && (
        <div className="card">
          <div className="card-header">
            <Target className="icon" size={20} />
            <h2>Step 3: Ball Colors</h2>
          </div>

          <div className="calibration-row">
            <label>Small Ball:</label>
            <div className="color-swatch" style={{ backgroundColor: colorToHex(smallBallColor) }} />
            <button
              className={`btn ${samplingMode === 'small' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => startSampling('small')}
            >
              <Crosshair size={16} />
              Sample
            </button>
            <span className="color-divider">or</span>
            <div className="hex-input-group">
              <Hash size={14} />
              <input
                type="text"
                placeholder="a21723"
                maxLength={7}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    applyHexColor(e.target.value, 'small')
                    e.target.value = ''
                  }
                }}
                onBlur={(e) => {
                  if (e.target.value) {
                    applyHexColor(e.target.value, 'small')
                    e.target.value = ''
                  }
                }}
              />
            </div>
            {smallBallColor && <span className="status-badge success">Set</span>}
          </div>

          <div className="calibration-row">
            <label>Big Ball (optional):</label>
            <div className="color-swatch" style={{ backgroundColor: colorToHex(bigBallColor) }} />
            <button
              className={`btn ${samplingMode === 'big' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => startSampling('big')}
            >
              <Crosshair size={16} />
              Sample
            </button>
            <span className="color-divider">or</span>
            <div className="hex-input-group">
              <Hash size={14} />
              <input
                type="text"
                placeholder="a21723"
                maxLength={7}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    applyHexColor(e.target.value, 'big')
                    e.target.value = ''
                  }
                }}
                onBlur={(e) => {
                  if (e.target.value) {
                    applyHexColor(e.target.value, 'big')
                    e.target.value = ''
                  }
                }}
              />
            </div>
            {bigBallColor && <span className="status-badge success">Set</span>}
          </div>
        </div>
      )}

      {/* Step 4: Record/Upload */}
      {isSetupComplete && (
        <div className="card">
          <div className="card-header">
            <FileVideo className="icon" size={20} />
            <h2>Step 4: {inputMode === 'stream' ? 'Record' : 'Upload Video'}</h2>
          </div>

          {inputMode === 'stream' ? (
            <>
              <p className="card-description">
                Record the ball trajectory from the live camera stream.
              </p>

              <div className="recording-controls">
                {!isRecording ? (
                  <button
                    className="btn btn-danger btn-record"
                    onClick={startRecording}
                    disabled={!isStreamConnected}
                  >
                    <Circle size={20} fill="currentColor" />
                    Start Recording
                  </button>
                ) : (
                  <button
                    className="btn btn-secondary btn-stop"
                    onClick={stopRecording}
                  >
                    <Square size={20} fill="currentColor" />
                    Stop ({recordedFrames.length} frames)
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="card-description">
                Record a video of the ball trajectory, then upload it here.
              </p>

              <input
                type="file"
                accept="video/*"
                ref={videoInputRef}
                onChange={handleVideoUpload}
                style={{ display: 'none' }}
              />

              {!videoFile ? (
                <button className="btn btn-primary upload-btn" onClick={() => videoInputRef.current?.click()}>
                  <Upload size={20} />
                  Upload Video
                </button>
              ) : (
                <div className="video-selected">
                  <Video size={24} />
                  <span>{videoName}</span>
                  <button className="btn btn-secondary" onClick={() => videoInputRef.current?.click()}>
                    Change
                  </button>
                </div>
              )}

              {videoFile && !isProcessing && (
                <button className="btn btn-success process-btn" onClick={processVideo}>
                  <Play size={20} />
                  Process Video
                </button>
              )}
            </>
          )}

          {isProcessing && (
            <div className="progress-container">
              <div className="progress-label">{progressLabel}</div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
              </div>
              {/* Live detection preview */}
              {debugFrame && (
                <div className="debug-frame-container">
                  <div className="debug-frame-header">Live Detection</div>
                  <img
                    src={debugFrame}
                    alt="Detection preview"
                    className="debug-frame-image"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Past Runs */}
      {allRuns.length > 0 && (
        <div className="card">
          <div className="card-header">
            <Settings className="icon" size={20} />
            <h2>Past Runs</h2>
          </div>
          <div className="past-runs">
            {allRuns.slice(-5).map((run) => (
              <button
                key={run.run_id}
                className="run-chip"
                onClick={async () => {
                  const runData = await api(`/runs/${run.run_id}`)
                  setCurrentRun(runData)
                  setScreen('results')
                }}
              >
                {new Date(run.timestamp).toLocaleDateString()}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Log Panel */}
      <LogPanel logs={logs} onClear={clearLogs} />

      {/* Hidden canvas for color sampling */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  )
}
