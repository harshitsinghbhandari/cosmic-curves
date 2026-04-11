import React, { useState, useEffect, useRef } from 'react';
import { CONFIG } from './config';
import Grid from './lib/grid';
import {
  Check,
  Loader2,
  Eye,
  EyeOff,
  RotateCcw,
  ZoomIn,
  Info,
  Circle,
  X as XIcon,
  Move,
  Trophy,
  BarChart3,
  Table,
  Image,
  ChevronDown,
  ChevronRight,
  Target,
  Ruler,
  Activity,
  Frame
} from 'lucide-react';
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
  const [zoomLevel, setZoomLevel] = useState(100);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [analysisTab, setAnalysisTab] = useState('stats');

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

  // Update zoom level display when grid scale changes
  useEffect(() => {
    if (screen === 'results' && gridRef.current) {
      const updateZoom = () => {
        setZoomLevel(Math.round(gridRef.current.getScale() * 100));
      };
      const interval = setInterval(updateZoom, 100);
      return () => clearInterval(interval);
    }
  }, [screen]);

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

  const handleResetView = () => {
    if (gridRef.current) {
      gridRef.current.resetView();
      setZoomLevel(100);
    }
  };

  // Render the detailed analysis panel
  const renderAnalysisPanel = () => {
    if (!selectedRun) return null;

    const stats = selectedRun.stats || {};
    const allFrames = selectedRun.all_frames || [];
    const coordinates = selectedRun.coordinates || [];
    const bigBall = selectedRun.big_ball_center || {};

    return (
      <div className="analysis-panel">
        <div className="analysis-header">
          <h3><BarChart3 size={18} /> Detailed Analysis</h3>
          <button className="close-btn" onClick={() => setShowAnalysis(false)}>
            <XIcon size={18} />
          </button>
        </div>

        <div className="analysis-tabs">
          <button className={analysisTab === 'stats' ? 'active' : ''} onClick={() => setAnalysisTab('stats')}>
            <Activity size={14} /> Stats
          </button>
          <button className={analysisTab === 'coords' ? 'active' : ''} onClick={() => setAnalysisTab('coords')}>
            <Table size={14} /> Coordinates
          </button>
          <button className={analysisTab === 'frames' ? 'active' : ''} onClick={() => setAnalysisTab('frames')}>
            <Frame size={14} /> All Frames
          </button>
          <button className={analysisTab === 'viz' ? 'active' : ''} onClick={() => setAnalysisTab('viz')}>
            <Image size={14} /> Visualization
          </button>
        </div>

        <div className="analysis-content">
          {analysisTab === 'stats' && (
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-label">Total Frames</div>
                <div className="stat-value">{stats.total_frames || 'N/A'}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Detected</div>
                <div className="stat-value success">{stats.detected_frames || 'N/A'}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Selected</div>
                <div className="stat-value">{stats.selected_frames || 'N/A'}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Rejected</div>
                <div className="stat-value warning">{stats.rejected_frames || 'N/A'}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Detection Rate</div>
                <div className="stat-value">{stats.detection_rate ? `${stats.detection_rate}%` : 'N/A'}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Avg Score</div>
                <div className="stat-value">{stats.avg_score || 'N/A'}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Min Score</div>
                <div className="stat-value">{stats.min_score || 'N/A'}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Max Score</div>
                <div className="stat-value">{stats.max_score || 'N/A'}</div>
              </div>

              <div className="stat-card wide">
                <div className="stat-label"><Ruler size={14} /> Calibration</div>
                <div className="stat-value">{stats.px_per_cm ? `${stats.px_per_cm} px/cm` : 'N/A'}</div>
              </div>
              <div className="stat-card wide">
                <div className="stat-label">Frame Size</div>
                <div className="stat-value">
                  {stats.frame_dimensions ? `${stats.frame_dimensions.width} × ${stats.frame_dimensions.height}` : 'N/A'}
                </div>
              </div>

              <div className="stat-card wide">
                <div className="stat-label"><Target size={14} /> Big Ball Center</div>
                <div className="stat-value">
                  ({bigBall.x_cm?.toFixed(2) || 0}, {bigBall.y_cm?.toFixed(2) || 0}) cm
                </div>
              </div>

              <div className="stat-card full">
                <div className="stat-label"><Trophy size={14} /> Winning Curve</div>
                <div className="stat-value highlight">{selectedRun.winning_curve?.toUpperCase() || 'N/A'}</div>
              </div>

              <div className="stat-card full">
                <div className="stat-label">Equation</div>
                <div className="equation-display">{selectedRun.equation?.display || 'N/A'}</div>
              </div>

              <div className="stat-card full">
                <div className="stat-label">All Curve Residuals</div>
                <div className="residuals-compare">
                  {selectedRun.residuals && Object.entries(selectedRun.residuals).map(([curve, residual]) => (
                    <div key={curve} className={`residual-row ${selectedRun.winning_curve === curve ? 'winner' : ''}`}>
                      <span className="curve-name">{curve}</span>
                      <span className="residual-bar">
                        <span className="bar-fill" style={{ width: `${Math.min(100, residual * 10)}%` }}></span>
                      </span>
                      <span className="residual-num">{residual.toFixed(4)}</span>
                      {selectedRun.winning_curve === curve && <Trophy size={12} className="winner-icon" />}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {analysisTab === 'coords' && (
            <div className="coords-table-wrapper">
              <table className="coords-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Frame</th>
                    <th>X (cm)</th>
                    <th>Y (cm)</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {coordinates.map((coord, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{coord.frame_index}</td>
                      <td>{coord.x_cm?.toFixed(3)}</td>
                      <td>{coord.y_cm?.toFixed(3)}</td>
                      <td className={coord.score > 0.7 ? 'good' : coord.score > 0.4 ? 'ok' : 'poor'}>
                        {coord.score?.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="table-summary">
                Total: {coordinates.length} points
              </div>
            </div>
          )}

          {analysisTab === 'frames' && (
            <div className="frames-table-wrapper">
              <div className="frames-summary">
                <span className="detected">Detected: {allFrames.filter(f => f.detected).length}</span>
                <span className="not-detected">Not Detected: {allFrames.filter(f => !f.detected).length}</span>
              </div>
              <table className="frames-table">
                <thead>
                  <tr>
                    <th>Frame #</th>
                    <th>Detected</th>
                    <th>X (px)</th>
                    <th>Y (px)</th>
                    <th>Radius</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {allFrames.map((frame, i) => (
                    <tr key={i} className={frame.detected ? 'detected' : 'not-detected'}>
                      <td>{frame.frame_index}</td>
                      <td>{frame.detected ? <Check size={14} className="success" /> : <XIcon size={14} className="error" />}</td>
                      <td>{frame.detected ? frame.x_px : '-'}</td>
                      <td>{frame.detected ? frame.y_px : '-'}</td>
                      <td>{frame.detected ? frame.radius_px : '-'}</td>
                      <td className={frame.score > 0.7 ? 'good' : frame.score > 0.4 ? 'ok' : 'poor'}>
                        {frame.detected ? frame.score.toFixed(3) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {analysisTab === 'viz' && (
            <div className="viz-panel">
              {selectedRun.visualization_url ? (
                <img
                  src={`${API_BASE}${selectedRun.visualization_url}`}
                  alt="Trajectory visualization"
                  className="viz-image"
                />
              ) : (
                <div className="no-viz">No visualization available</div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div id="app">
      {screen === 'home' && (
        <div id="home-screen" className="screen active">
          <h1>Ball Trajectory Tracker</h1>
          <div className="actions">
            <button onClick={createNewSession} className="primary" aria-label={sessionCode ? "Resume existing session" : "Create new session"}>
               {sessionCode ? "Resume Session" : "New Session"}
            </button>
            <button onClick={loadResults} aria-label="View past tracking runs">View Past Runs</button>
          </div>
        </div>
      )}

      {screen === 'session' && (
        <div id="session-screen" className="screen active">
          <h2>Join on Phone</h2>
          <div id="qr-container">
            <img src={qrCode} alt="QR Code to join session" />
          </div>
          <p>Scan this QR with your phone to open the capture app</p>
          <p className="small">Or enter code manually:</p>
          <div className="session-code" aria-label={`Session code: ${sessionCode}`}>{sessionCode}</div>
          <div className="status-indicator" role="status" aria-live="polite">
            {status.status === 'recording' || status.calibrated || status.colors_set ? (
              <>
                <Check className="status-icon success" size={20} aria-hidden="true" />
                <span>Phone connected</span>
              </>
            ) : (
              <>
                <Loader2 className="status-icon spinning" size={20} aria-hidden="true" />
                <span>Waiting for phone connection...</span>
              </>
            )}
          </div>
          <button onClick={() => setScreen('home')} className="secondary" style={{marginTop: 20}} aria-label="Go back to home">Back</button>
        </div>
      )}

      {screen === 'setup' && (
        <div id="setup-status-screen" className="screen active">
          <h2>Phone Setup Status</h2>
          <div className="status-box" role="status" aria-live="polite">
            <p className={status.calibrated ? "success" : ""}>
              {status.calibrated ? (
                <>
                  <Check className="status-icon success" size={18} aria-hidden="true" />
                  <span>Scale calibrated</span>
                </>
              ) : (
                <>
                  <Loader2 className="status-icon spinning" size={18} aria-hidden="true" />
                  <span>Waiting for calibration...</span>
                </>
              )}
            </p>
            <p className={status.colors_set ? "success" : ""}>
              {status.colors_set ? (
                <>
                  <Check className="status-icon success" size={18} aria-hidden="true" />
                  <span>Colors configured</span>
                </>
              ) : (
                <>
                  <Loader2 className="status-icon spinning" size={18} aria-hidden="true" />
                  <span>Waiting for color setup...</span>
                </>
              )}
            </p>
          </div>
          {status.calibrated && status.colors_set && (
            <button onClick={() => setScreen('record')} className="primary" aria-label="Proceed to recording screen">Go to Record Screen</button>
          )}
          <button onClick={() => setScreen('home')} className="secondary" style={{marginTop: 20}} aria-label="Cancel and return home">Cancel Session</button>
        </div>
      )}

      {screen === 'record' && (
        <div id="record-screen" className="screen active">
          <h2>Recording Control</h2>
          <div className="recording-indicator" role="status" aria-live="polite">
            <span className="animated-dot" aria-hidden="true"></span>
            <span>{status.status === 'recording' ? "Recording in progress" : "Waiting for recording..."}</span>
          </div>
          <div className="stats">
            <p>Frames captured: {frameCount}</p>
          </div>
          <button onClick={stopRecord} className="danger" aria-label="Stop recording and analyze">Stop & Analyze</button>
        </div>
      )}

      {screen === 'processing' && (
        <div id="processing-screen" className="screen active">
          <h2>Analyzing Runs...</h2>
          <div className="progress-container" role="progressbar" aria-valuenow={Math.round(progress.value * 100)} aria-valuemin="0" aria-valuemax="100">
            <div className="progress-bar" style={{ width: `${progress.value * 100}%` }}></div>
          </div>
          <p aria-live="polite">{progress.label}</p>
          {error && (
            <>
              <p className="error" role="alert">{error}</p>
              <button onClick={() => setScreen('record')} className="danger" aria-label="Return to recording to try again">Try Again</button>
            </>
          )}
        </div>
      )}

      {screen === 'results' && (
        <div id="results-screen" className={`screen active results-layout ${showAnalysis ? 'with-analysis' : ''}`}>
          <div className="sidebar" role="complementary" aria-label="Run controls and details">
            <h3>Runs</h3>
            <div id="run-list" role="list">
              {runs.map(r => (
                <div
                  key={r.run_id}
                  className={`run-item ${selectedRun?.run_id === r.run_id ? 'selected' : ''}`}
                  onClick={() => setSelectedRun(r)}
                  role="listitem"
                  tabIndex={0}
                  aria-selected={selectedRun?.run_id === r.run_id}
                  onKeyDown={(e) => e.key === 'Enter' && setSelectedRun(r)}
                >
                  <div
                    className="swatch"
                    style={{ backgroundColor: gridRef.current?.runColors[r.run_id] || '#ccc' }}
                    onClick={(e) => { e.stopPropagation(); cycleColor(r.run_id); }}
                    role="button"
                    aria-label="Change run color"
                    tabIndex={0}
                    onKeyDown={(e) => { e.key === 'Enter' && (e.stopPropagation(), cycleColor(r.run_id)); }}
                  ></div>
                  <div className="run-title">
                    <span className="run-label">Run {r.session_code}</span>
                    <span className="run-meta">{new Date(r.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} · {r.coordinates?.length || 0} pts</span>
                  </div>
                  <button
                    className="toggle-vis"
                    onClick={(e) => { e.stopPropagation(); toggleVis(r.run_id); }}
                    aria-label={gridRef.current?.visibleRuns.has(r.run_id) ? "Hide run" : "Show run"}
                  >
                    {gridRef.current?.visibleRuns.has(r.run_id) ? (
                      <Eye size={18} aria-hidden="true" />
                    ) : (
                      <EyeOff size={18} aria-hidden="true" />
                    )}
                  </button>
                </div>
              ))}
            </div>

            {/* Analysis Toggle Button */}
            <button
              className={`analysis-toggle ${showAnalysis ? 'active' : ''}`}
              onClick={() => setShowAnalysis(!showAnalysis)}
              aria-label="Toggle detailed analysis panel"
            >
              <BarChart3 size={16} />
              {showAnalysis ? 'Hide Analysis' : 'Show Analysis'}
            </button>

            <button onClick={() => setScreen('home')} className="secondary" aria-label="Start new session">+ New Session</button>

            <div className="controls" role="group" aria-label="Visualization options">
              <h4>Visualization</h4>
              <label>
                <input
                  type="radio"
                  name="vis-toggle"
                  value="dots"
                  checked={visMode === 'dots'}
                  onChange={(e) => handleVisModeChange(e.target.value)}
                  aria-label="Show data points only"
                />
                <Circle size={14} aria-hidden="true" /> Dots
              </label>
              <label>
                <input
                  type="radio"
                  name="vis-toggle"
                  value="curve"
                  checked={visMode === 'curve'}
                  onChange={(e) => handleVisModeChange(e.target.value)}
                  aria-label="Show fitted curve only"
                />
                <span className="curve-icon" aria-hidden="true">~</span> Curve
              </label>
              <label>
                <input
                  type="radio"
                  name="vis-toggle"
                  value="both"
                  checked={visMode === 'both'}
                  onChange={(e) => handleVisModeChange(e.target.value)}
                  aria-label="Show both dots and curve"
                />
                <span aria-hidden="true">Both</span>
              </label>
            </div>

            {selectedRun && (
              <div className="run-details">
                <h4>Selected Run Equation</h4>
                <p className="equation-text">{selectedRun.equation?.display}</p>
                <p className="eq-type">Type: {selectedRun.equation?.type}</p>

                <details className="residuals" open>
                  <summary>
                    <Info size={14} aria-hidden="true" />
                    Residuals (lower = better fit)
                  </summary>
                  <div className="residuals-list">
                    {selectedRun.residuals && Object.entries(selectedRun.residuals).map(([key, val]) => (
                      <div key={key} className={selectedRun.winning_curve === key ? 'winning' : ''}>
                        <span className="residual-name">{key}</span>
                        <span className="residual-value">
                          {val.toFixed(4)}
                          {selectedRun.winning_curve === key && (
                            <Trophy size={14} className="winner-badge" aria-label="Best fit" />
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </div>

          <div className="canvas-container" role="img" aria-label="Trajectory visualization canvas">
            <canvas ref={canvasRef} id="grid-canvas"></canvas>
            <div id="tooltip" className="tooltip" role="tooltip"></div>

            {/* HUD Overlay */}
            <div className="canvas-hud" aria-label="Canvas controls">
              <div className="hud-zoom">
                <ZoomIn size={14} aria-hidden="true" />
                <span>{zoomLevel}%</span>
              </div>
              <button
                className="hud-reset"
                onClick={handleResetView}
                aria-label="Reset view to default zoom and position"
              >
                <RotateCcw size={14} aria-hidden="true" />
                Reset View
              </button>
              <div className="hud-hint">
                <Move size={12} aria-hidden="true" />
                Scroll to zoom · Drag to pan
              </div>
            </div>

            {/* Legend */}
            <div className="canvas-legend" aria-label="Visualization legend">
              <div className="legend-item">
                <span className="legend-dot" aria-hidden="true"></span>
                Data points
              </div>
              <div className="legend-item">
                <span className="legend-curve" aria-hidden="true">~</span>
                Fitted equation
              </div>
              <div className="legend-item">
                <XIcon size={14} className="legend-x" aria-hidden="true" />
                Big ball center
              </div>
            </div>
          </div>

          {/* Analysis Panel */}
          {showAnalysis && renderAnalysisPanel()}
        </div>
      )}
    </div>
  );
}

export default App;
