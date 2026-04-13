import { useState, useEffect, useRef } from 'react'

// Animated trajectory SVG
function TrajectoryAnimation() {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(p => (p + 0.8) % 100)
    }, 30)
    return () => clearInterval(interval)
  }, [])

  // Parabolic path points
  const getPoint = (t) => {
    const x = 50 + t * 4
    const y = 280 - (t * 2.8 - 0.05 * t * t)
    return { x, y }
  }

  const points = []
  for (let i = 0; i <= progress; i += 2) {
    points.push(getPoint(i))
  }

  const currentPoint = getPoint(progress)

  return (
    <svg viewBox="0 0 500 350" className="trajectory-svg">
      {/* Grid lines */}
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(0, 245, 255, 0.06)" strokeWidth="1"/>
        </pattern>
        <linearGradient id="trailGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ff00aa" stopOpacity="0" />
          <stop offset="100%" stopColor="#00f5ff" stopOpacity="1" />
        </linearGradient>
        <radialGradient id="ballGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#00f5ff" stopOpacity="1" />
          <stop offset="70%" stopColor="#00f5ff" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#00f5ff" stopOpacity="0" />
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      <rect width="500" height="350" fill="url(#grid)" />

      {/* Axis labels */}
      <text x="480" y="295" className="axis-label">x</text>
      <text x="55" y="30" className="axis-label">y</text>

      {/* Axes */}
      <line x1="50" y1="280" x2="480" y2="280" stroke="rgba(0, 245, 255, 0.3)" strokeWidth="1" />
      <line x1="50" y1="280" x2="50" y2="20" stroke="rgba(0, 245, 255, 0.3)" strokeWidth="1" />

      {/* Trail path */}
      {points.length > 1 && (
        <path
          d={`M ${points.map(p => `${p.x},${p.y}`).join(' L ')}`}
          stroke="url(#trailGrad)"
          strokeWidth="3"
          fill="none"
          filter="url(#glow)"
          strokeLinecap="round"
        />
      )}

      {/* Detection points */}
      {points.filter((_, i) => i % 4 === 0).map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r="4"
          fill="#ff00aa"
          opacity={0.6 + (i / points.length) * 0.4}
        />
      ))}

      {/* Current ball */}
      <circle cx={currentPoint.x} cy={currentPoint.y} r="20" fill="url(#ballGlow)" />
      <circle cx={currentPoint.x} cy={currentPoint.y} r="10" fill="#00f5ff" filter="url(#glow)" />

      {/* Equation overlay */}
      <text x="320" y="70" className="equation-text">y = -0.05x² + 2.8x</text>
      <text x="320" y="95" className="equation-subtext">R² = 0.9847</text>
    </svg>
  )
}

// Workflow step component
function WorkflowStep({ number, title, description, icon }) {
  return (
    <div className="workflow-step">
      <div className="step-number">{number.toString().padStart(2, '0')}</div>
      <div className="step-icon">{icon}</div>
      <h3 className="step-title">{title}</h3>
      <p className="step-description">{description}</p>
    </div>
  )
}

// Feature card
function FeatureCard({ icon, title, description }) {
  return (
    <div className="feature-card">
      <div className="feature-icon">{icon}</div>
      <h3 className="feature-title">{title}</h3>
      <p className="feature-description">{description}</p>
    </div>
  )
}

// Tech badge
function TechBadge({ name, description }) {
  return (
    <div className="tech-badge">
      <span className="tech-name">{name}</span>
      <span className="tech-desc">{description}</span>
    </div>
  )
}

// Scanline effect
function Scanlines() {
  return <div className="scanlines" />
}

export default function App() {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const heroRef = useRef(null)

  useEffect(() => {
    const handleMouse = (e) => {
      if (heroRef.current) {
        const rect = heroRef.current.getBoundingClientRect()
        setMousePos({
          x: ((e.clientX - rect.left) / rect.width) * 100,
          y: ((e.clientY - rect.top) / rect.height) * 100
        })
      }
    }
    window.addEventListener('mousemove', handleMouse)
    return () => window.removeEventListener('mousemove', handleMouse)
  }, [])

  return (
    <div className="landing">
      <Scanlines />

      {/* Navigation */}
      <nav className="nav">
        <div className="nav-brand">
          <span className="brand-icon">◉</span>
          <span className="brand-text">CosmosCurves</span>
        </div>
        <div className="nav-links">
          <a href="#features">Features</a>
          <a href="#workflow">How It Works</a>
          <a href="#tech">Tech</a>
          <a
            href="https://github.com/harshitsinghbhandari/cosmic-curves"
            className="nav-cta"
            target="_blank"
            rel="noopener noreferrer"
          >
            View on GitHub →
          </a>
        </div>
      </nav>

      {/* Hero Section */}
      <section
        className="hero"
        ref={heroRef}
        style={{
          '--mouse-x': `${mousePos.x}%`,
          '--mouse-y': `${mousePos.y}%`
        }}
      >
        <div className="hero-glow" />
        <div className="hero-content">
          <div className="hero-badge">
            <span className="badge-dot" />
            PHYSICS EXPERIMENT TOOL
          </div>
          <h1 className="hero-title">
            Track trajectories.<br/>
            <span className="gradient-text">Fit curves.</span><br/>
            Understand motion.
          </h1>
          <p className="hero-subtitle">
            Turn any phone camera into a precision physics lab.
            CosmosCurves uses computer vision to track ball trajectories
            and automatically fits mathematical curves to the motion.
          </p>
          <div className="hero-actions">
            <a
              href="https://github.com/harshitsinghbhandari/cosmic-curves"
              className="btn btn-primary"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="btn-icon">⬡</span>
              Get Started on GitHub
            </a>
            <a href="#workflow" className="btn btn-secondary">
              See How It Works
            </a>
          </div>
          <div className="hero-stats">
            <div className="stat">
              <span className="stat-value">OpenCV</span>
              <span className="stat-label">Computer Vision</span>
            </div>
            <div className="stat-divider" />
            <div className="stat">
              <span className="stat-value">Real-time</span>
              <span className="stat-label">Detection</span>
            </div>
            <div className="stat-divider" />
            <div className="stat">
              <span className="stat-value">Parabola</span>
              <span className="stat-label">+ More Curves</span>
            </div>
          </div>
        </div>
        <div className="hero-visual">
          <div className="visual-frame">
            <div className="frame-corner tl" />
            <div className="frame-corner tr" />
            <div className="frame-corner bl" />
            <div className="frame-corner br" />
            <TrajectoryAnimation />
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="features">
        <div className="section-header">
          <span className="section-tag">CAPABILITIES</span>
          <h2 className="section-title">Physics meets precision</h2>
        </div>
        <div className="features-grid">
          <FeatureCard
            icon="📹"
            title="IP Camera Integration"
            description="Connect any phone running IP Webcam, DroidCam, or similar. Stream video directly over your local network."
          />
          <FeatureCard
            icon="🎯"
            title="Color-Based Detection"
            description="Euclidean distance masking in BGR color space. Click to sample colors, track objects with pixel-level accuracy."
          />
          <FeatureCard
            icon="📐"
            title="Automatic Calibration"
            description="Place two markers of known distance. The system calculates px/cm scale and axis orientation automatically."
          />
          <FeatureCard
            icon="📈"
            title="Curve Fitting"
            description="Fits parabolic, linear, and polynomial curves. Shows equations with R² correlation scores."
          />
          <FeatureCard
            icon="🖼️"
            title="Frame Gallery"
            description="Review every processed frame with detection overlays. Playback detected frames as video."
          />
          <FeatureCard
            icon="💾"
            title="Run History"
            description="All experiments saved locally. Compare trajectories across runs, export data for further analysis."
          />
        </div>
      </section>

      {/* Workflow Section */}
      <section id="workflow" className="workflow">
        <div className="section-header">
          <span className="section-tag">PROCESS</span>
          <h2 className="section-title">Four steps to trajectory data</h2>
        </div>
        <div className="workflow-grid">
          <WorkflowStep
            number={1}
            icon="📶"
            title="Connect Camera"
            description="Enter your phone's IP camera URL. The stream appears instantly in the browser."
          />
          <WorkflowStep
            number={2}
            icon="🎨"
            title="Calibrate"
            description="Sample marker and ball colors by clicking the video. Set your known distance for scale."
          />
          <WorkflowStep
            number={3}
            icon="⏺️"
            title="Record"
            description="Hit record, perform your experiment, stop. Frames are captured and queued for processing."
          />
          <WorkflowStep
            number={4}
            icon="📊"
            title="Analyze"
            description="View the fitted curve, equation, and trajectory visualization. Browse the detection gallery."
          />
        </div>
        <div className="workflow-visual">
          <div className="terminal">
            <div className="terminal-header">
              <span className="terminal-dot red" />
              <span className="terminal-dot yellow" />
              <span className="terminal-dot green" />
              <span className="terminal-title">Setup Instructions</span>
            </div>
            <div className="terminal-body">
              <code>
                <span className="comment"># Clone the repository</span>{'\n'}
                <span className="prompt">$</span> git clone https://github.com/harshitsinghbhandari/cosmic-curves.git{'\n'}
                <span className="prompt">$</span> cd cosmoscurves{'\n\n'}

                <span className="comment"># Install dependencies</span>{'\n'}
                <span className="prompt">$</span> cd app && npm install{'\n'}
                <span className="prompt">$</span> cd ../backend && pip install -r requirements.txt{'\n\n'}

                <span className="comment"># Start the application</span>{'\n'}
                <span className="prompt">$</span> ./start.sh{'\n\n'}

                <span className="output">✓ Backend running on http://localhost:8000</span>{'\n'}
                <span className="output">✓ Frontend running on http://localhost:3000</span>{'\n'}
                <span className="success">Ready to track trajectories!</span>
              </code>
            </div>
          </div>
        </div>
      </section>

      {/* Tech Stack Section */}
      <section id="tech" className="tech">
        <div className="section-header">
          <span className="section-tag">ARCHITECTURE</span>
          <h2 className="section-title">Built with</h2>
        </div>
        <div className="tech-grid">
          <TechBadge name="React + Vite" description="Frontend UI" />
          <TechBadge name="FastAPI" description="Python Backend" />
          <TechBadge name="OpenCV" description="Computer Vision" />
          <TechBadge name="NumPy" description="Numerical Computing" />
          <TechBadge name="Canvas API" description="Visualization" />
          <TechBadge name="MJPEG" description="Video Streaming" />
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta">
        <div className="cta-content">
          <h2 className="cta-title">Ready to experiment?</h2>
          <p className="cta-subtitle">
            Clone the repo, set up in minutes, start tracking trajectories.
          </p>
          <a
            href="https://github.com/harshitsinghbhandari/cosmic-curves"
            className="btn btn-primary btn-large"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="btn-icon">⬡</span>
            View on GitHub
          </a>
        </div>
        <div className="cta-decoration">
          <div className="orbit orbit-1" />
          <div className="orbit orbit-2" />
          <div className="orbit orbit-3" />
          <div className="planet" />
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-content">
          <div className="footer-brand">
            <span className="brand-icon">◉</span>
            <span className="brand-text">CosmosCurves</span>
          </div>
          <div className="footer-links">
            <a href="https://github.com/harshitsinghbhandari/cosmic-curves" target="_blank" rel="noopener noreferrer">GitHub</a>
            <span className="footer-divider">•</span>
            <span className="footer-copy">MIT License</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
