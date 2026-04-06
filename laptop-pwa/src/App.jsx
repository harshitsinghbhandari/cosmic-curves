import React, { useState, useEffect, useRef } from 'react';
import { CONFIG } from './config';
import Grid from './lib/grid';
import './index.css';

const API_BASE = CONFIG.API_BASE;
const STATUS_POLL_INTERVAL_MS = CONFIG.STATUS_POLL_INTERVAL_MS;
const PROCESSING_POLL_INTERVAL_MS = CONFIG.PROCESSING_POLL_INTERVAL_MS;

function App() {
  const [screen, setScreen] = useState('home');
  const [sessionCode, setSessionCode] = useState(localStorage.getItem('activeSession') || null);
  const [qrCode, setQrCode] = useState('');
  const [status, setStatus] = useState({ status: 'idle' });
  const [frameCount, setFrameCount] = useState(0);
  const [progress, setProgress] = useState({ value: 0, label: 'Initializing...' });
  const [runs, setRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [visMode, setVisMode] = useState('both');
  const [error, setError] = useState('');

  const gridRef = useRef(null);
  const canvasRef = useRef(null);
  const pollTimerRef = useRef(null);

  // Helper for API calls
  const api = async (path, method = "GET", body = null, headers = {}) => {
    const defaultHeaders = { 'Content-Type': 'application/json' };
    if (sessionCode) defaultHeaders['X-Session-Code'] = sessionCode;

    const options = { method, headers: { ...defaultHeaders, ...headers } };
    if (body) options.body = typeof body === 'string' ? body : JSON.stringify(body);

    const r = await fetch(`${API_BASE}${path}`, options);
    if (!r.ok) {
      let err;
      try { err = (await r.json()).error; } catch (e) { err = r.statusText; }
      throw new Error(err);
    }
    return await r.json();
  };

  // Poll for status
  useEffect(() => {
    if (['session', 'setup', 'record', 'processing'].includes(screen)) {
      const interval = (screen === 'processing') ? PROCESSING_POLL_INTERVAL_MS : STATUS_POLL_INTERVAL_MS;
      
      pollTimerRef.current = setInterval(async () => {
        try {
          const res = await api('/status');
          setStatus(res);
          
          if (screen === 'session' && (res.status === 'recording' || res.calibrated || res.colors_set)) {
             setScreen('setup');
          }
          
          if (screen === 'setup' && res.status === 'recording') {
            setScreen('record');
          }
          
          if (screen === 'record' && res.frame_count !== undefined) {
            setFrameCount(res.frame_count);
          }
          
          if (screen === 'processing') {
            if (res.status === 'processing') {
              setProgress({ value: res.progress, label: res.progress_label });
            } else if (res.status === 'done') {
              clearInterval(pollTimerRef.current);
              setProgress({ value: 1, label: 'Done' });
              setTimeout(() => {
                loadResults();
              }, 800);
            } else if (res.status === 'error') {
              clearInterval(pollTimerRef.current);
              setError(res.error);
            }
          }
        } catch (e) {
          console.error(e);
        }
      }, interval);
      
      return () => clearInterval(pollTimerRef.current);
    }
  }, [screen, sessionCode]);

  // Initializing Grid
  useEffect(() => {
    if (screen === 'results' && canvasRef.current && !gridRef.current) {
        gridRef.current = new Grid(canvasRef.current);
        if (runs.length > 0) {
            gridRef.current.setRuns(runs);
        }
    }
  }, [screen, runs]);

  const createNewSession = async () => {
    try {
      const res = await api('/session/new', 'POST');
      setSessionCode(res.session_code);
      localStorage.setItem('activeSession', res.session_code);
      setQrCode(`data:image/png;base64,${res.qr_code_base64}`);
      setScreen('session');
    } catch (e) {
      alert("Failed to create session: " + e.message);
    }
  };

  const loadResults = async () => {
    setScreen('results');
    try {
      const res = await api('/runs');
      const sortedRuns = res.runs.reverse();
      setRuns(sortedRuns);
      if (sortedRuns.length > 0) {
        setSelectedRun(sortedRuns[0]);
      }
    } catch (e) {
      alert("Failed to load runs: " + e.message);
    }
  };

  const stopRecord = async () => {
    try {
      await api('/stop', 'POST', {});
      setScreen('processing');
    } catch (e) {
      alert("Stop failed: " + e.message);
      setScreen('processing');
    }
  };

  const toggleVis = (runId) => {
    if (gridRef.current) {
        gridRef.current.toggleVisibility(runId);
        // Force re-render of list to show icon change
        setRuns([...runs]);
    }
  };

  const cycleColor = (runId) => {
    if (gridRef.current) {
        gridRef.current.cycleColor(runId);
        setRuns([...runs]);
    }
  };

  const handleVisModeChange = (mode) => {
    setVisMode(mode);
    if (gridRef.current) {
        gridRef.current.setMode(mode);
    }
  };

  return (
    <div id="app">
      {screen === 'home' && (
        <div id="home-screen" className="screen active">
          <h1>Ball Trajectory Tracker</h1>
          <div className="actions">
            <button onClick={createNewSession} className="primary">
               {sessionCode ? "Resume Session" : "New Session"}
            </button>
            <button onClick={loadResults}>View Past Runs</button>
          </div>
        </div>
      )}

      {screen === 'session' && (
        <div id="session-screen" className="screen active">
          <h2>Join on Phone</h2>
          <div id="qr-container">
            <img src={qrCode} alt="QR Code" />
          </div>
          <p>Scan this QR with your phone to open the capture app</p>
          <p className="small">Or enter code manually:</p>
          <div className="session-code">{sessionCode}</div>
          <div className="status-indicator">
            {status.status === 'recording' || status.calibrated || status.colors_set ? "✓ Phone connected" : "⏳ Waiting for phone connection..."}
          </div>
          <button onClick={() => setScreen('home')} className="secondary" style={{marginTop: 20}}>Back</button>
        </div>
      )}

      {screen === 'setup' && (
        <div id="setup-status-screen" className="screen active">
          <h2>Phone Setup Status</h2>
          <div className="status-box">
            <p className={status.calibrated ? "success" : ""}>
               {status.calibrated ? `✓ Calibrated: ${status.px_per_cm.toFixed(1)} px/cm` : "⏳ Waiting for calibration..."}
            </p>
            <p className={status.colors_set ? "success" : ""}>
               {status.colors_set ? "✓ Colors set" : "⏳ Waiting for color setup..."}
            </p>
          </div>
          {status.calibrated && status.colors_set && (
            <button onClick={() => setScreen('record')} className="primary">Go to Record Screen</button>
          )}
          <button onClick={() => setScreen('home')} className="secondary" style={{marginTop: 20}}>Cancel Session</button>
        </div>
      )}

      {screen === 'record' && (
        <div id="record-screen" className="screen active">
          <h2>Recording Control</h2>
          <div className="recording-indicator">
            <span className="animated-dot"></span> <span>{status.status === 'recording' ? "Recording..." : "Waiting..."}</span>
          </div>
          <div className="stats">
            <p>Frames: {frameCount}</p>
          </div>
          <button onClick={stopRecord} className="danger">Stop & Analyze</button>
        </div>
      )}

      {screen === 'processing' && (
        <div id="processing-screen" className="screen active">
          <h2>Analyzing Runs...</h2>
          <div className="progress-container">
            <div className="progress-bar" style={{ width: `${progress.value * 100}%` }}></div>
          </div>
          <p>{progress.label}</p>
          {error && (
            <>
              <p className="error">{error}</p>
              <button onClick={() => setScreen('record')} className="danger">Try Again</button>
            </>
          )}
        </div>
      )}

      {screen === 'results' && (
        <div id="results-screen" className="screen active results-layout">
          <div className="sidebar">
            <h3>Runs</h3>
            <div id="run-list">
              {runs.map(r => (
                <div 
                  key={r.run_id} 
                  className={`run-item ${selectedRun?.run_id === r.run_id ? 'selected' : ''}`}
                  onClick={() => setSelectedRun(r)}
                >
                  <div 
                    className="swatch" 
                    style={{ backgroundColor: gridRef.current?.runColors[r.run_id] || '#ccc' }}
                    onClick={(e) => { e.stopPropagation(); cycleColor(r.run_id); }}
                  ></div>
                  <div className="run-title">
                    Run {r.session_code} · {new Date(r.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </div>
                  <div className="toggle-vis" onClick={(e) => { e.stopPropagation(); toggleVis(r.run_id); }}>
                    {gridRef.current?.visibleRuns.has(r.run_id) ? '👁' : '∅'}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setScreen('home')} className="secondary">+ New Session</button>
            
            <div className="controls">
              <h4>Visualization</h4>
              <label><input type="radio" name="vis-toggle" value="dots" checked={visMode === 'dots'} onChange={(e) => handleVisModeChange(e.target.value)} /> Dots</label>
              <label><input type="radio" name="vis-toggle" value="curve" checked={visMode === 'curve'} onChange={(e) => handleVisModeChange(e.target.value)} /> Curve</label>
              <label><input type="radio" name="vis-toggle" value="both" checked={visMode === 'both'} onChange={(e) => handleVisModeChange(e.target.value)} /> Both</label>
            </div>
            
            {selectedRun && (
              <div className="run-details">
                <h4>Selected run equation:</h4>
                <p className="equation-text">{selectedRun.equation.display}</p>
                <p className="eq-type">Type: {selectedRun.equation.type}</p>
                
                <details className="residuals">
                  <summary>Residuals ▼</summary>
                  <div>
                    {Object.entries(selectedRun.residuals).map(([key, val]) => (
                      <div key={key}>{key}: {val.toFixed(4)}{selectedRun.winning_curve === key ? ' ✓' : ''}</div>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </div>
          <div className="canvas-container">
            <canvas ref={canvasRef} id="grid-canvas"></canvas>
            <div id="tooltip" className="tooltip"></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
