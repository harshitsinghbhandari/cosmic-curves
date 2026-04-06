"""
Ball Trajectory Tracker - FastAPI Backend

This module provides the main FastAPI application for the Ball Trajectory Tracker.
It handles session management, frame processing, ball detection, and curve fitting
for physics experiments tracking ball trajectories.

Architecture:
- Sessions are managed in-memory with unique codes
- Frames are stored temporarily during recording
- Results are persisted to JSON file storage
- Processing runs in background tasks for non-blocking responses

Author: CosmosCurves Team
License: MIT
"""

import uuid
import random
import string
import os
import io
import base64
import time
import shutil
import cv2
import numpy as np
import logging
from datetime import datetime, timezone
from fastapi import FastAPI, Header, HTTPException, Request, BackgroundTasks
from fastapi.responses import JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
import qrcode
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm

from session import sessions, SessionState, get_session_by_code, clean_old_sessions
from storage import init_storage, get_all_runs, get_run_by_id, append_run
from calibration import process_calibration_frame
from detection import compute_hsv_ranges, detect_ball_in_frame, MIN_CONTOUR_AREA_PX, MIN_CIRCULARITY, MIN_DETECTION_SCORE, TARGET_FRAMES, MIN_VALID_FRAMES
from curve_fitting import fit_curves
from config import PHONE_PWA_URL
from contextlib import asynccontextmanager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[
        logging.FileHandler("backend.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("cosmoscurves")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup and shutdown events.
    """
    init_storage()
    os.makedirs(SESSIONS_DATA_DIR, exist_ok=True)
    logger.info("Storage initialized and backend started.")
    yield
    logger.info("Backend shutting down.")

# Initialize FastAPI application with metadata
app = FastAPI(
    title="Ball Trajectory Tracker",
    description="Backend API for tracking and analyzing ball trajectories in physics experiments",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS", "PUT", "DELETE"],
    allow_headers=["Content-Type", "X-Session-Code", "X-Frame-Index", "Authorization"],
    expose_headers=["X-Session-Code"],
)

# Directory paths for data storage
current_dir = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(current_dir, "data")
SESSIONS_DATA_DIR = os.path.join(DATA_DIR, "sessions")




@app.post("/session/new")
def new_session():
    """
    Create a new experiment session.

    Generates a unique 6-character session code and QR code for phone linking.
    The QR code encodes the capture URL with the session code as a parameter.

    Returns:
        dict: Session details including:
            - session_code: 6-character alphanumeric code
            - session_id: UUID for internal use
            - qr_code_base64: Base64-encoded QR code PNG image
            - capture_url: Full URL for phone capture app

    Example:
        POST /session/new
        Response: {
            "session_code": "A4K9XZ",
            "session_id": "uuid-string",
            "qr_code_base64": "iVBORw0KGgo...",
            "capture_url": "https://app.yourdomain.com/capture?session=A4K9XZ"
        }
    """
    try:
        # Periodic cleanup of old sessions
        cleaned_count = clean_old_sessions()
        if cleaned_count > 0:
            logger.info(f"Cleaned up {cleaned_count} expired sessions.")

        session_id = str(uuid.uuid4())
        session_code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
        
        frames_dir = os.path.join(SESSIONS_DATA_DIR, session_id, "frames")
        os.makedirs(frames_dir, exist_ok=True)
        
        state = SessionState(
            session_id=session_id,
            session_code=session_code,
            frames_dir=frames_dir
        )
        sessions[session_id] = state
        
        base_url = PHONE_PWA_URL
        capture_url = f"{base_url}/capture" if base_url.endswith("/capture") else f"{base_url}/index.html?session={session_code}"
        
        # In this project, the phone app is likely served at the root or /index.html
        # If the user is serving it via a simple server, e.g., on port 3001
        capture_url = f"{PHONE_PWA_URL}?session={session_code}"
        
        qr = qrcode.QRCode(version=1, box_size=10, border=4)
        qr.add_data(capture_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        
        buffered = io.BytesIO()
        img.save(buffered, format="PNG")
        qr_code_base64 = base64.b64encode(buffered.getvalue()).decode("utf-8")
        
        logger.info(f"New session created: {session_code} (ID: {session_id})")
        logger.info(f"Session capture URL: {capture_url}")
        
        return {
            "session_code": session_code,
            "session_id": session_id,
            "qr_code_base64": qr_code_base64,
            "capture_url": capture_url
        }
    except Exception as e:
        logger.error(f"Failed to create new session: {str(e)}", exc_info=True)
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})

@app.get("/calibration-sheet.pdf")
def get_calibration_sheet():
    try:
        buffer = io.BytesIO()
        c = pdf_canvas.Canvas(buffer, pagesize=A4)
        width, height = A4
        c.setFillColorRGB(0, 0, 0)
        c.circle(width / 2.0, height / 2.0, 4.5 * cm, stroke=0, fill=1)
        c.setFont("Helvetica", 14)
        c.drawCentredString(width / 2.0, height / 2.0 - 6 * cm, "Ball Tracker Calibration Marker — Do not resize when printing")
        c.save()
        return Response(content=buffer.getvalue(), media_type="application/pdf")
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})

@app.post("/calibrate")
async def calibrate(request: Request, x_session_code: str = Header(None)):
    try:
        if not x_session_code:
            raise ValueError("X-Session-Code header missing")
        state = get_session_by_code(x_session_code)
        if not state:
            raise ValueError("Session not found")
            
        body = await request.body()
        px_per_cm, marker_radius_px = process_calibration_frame(body)
        state.px_per_cm = px_per_cm
        
        logger.info(f"Session {x_session_code} calibrated: {px_per_cm:.2f} px/cm")
        return {"ok": True, "px_per_cm": px_per_cm, "marker_radius_px": marker_radius_px}
    except Exception as e:
        logger.error(f"Calibration failed for session {x_session_code}: {str(e)}")
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})

@app.post("/setup")
async def setup(request: Request, x_session_code: str = Header(None)):
    try:
        if not x_session_code:
            raise ValueError("X-Session-Code header missing")
        state = get_session_by_code(x_session_code)
        if not state:
            raise ValueError("Session not found")
            
        data = await request.json()
        small_ball_hsv = data.get("small_ball_hsv", {})
        sheet_hsv = data.get("sheet_hsv", {})
        big_ball_hsv = data.get("big_ball_hsv", {})
        
        small_ball_range = compute_hsv_ranges(small_ball_hsv)
        big_ball_range = compute_hsv_ranges(big_ball_hsv)
        
        state.hsv_ranges = {
            "small_ball_range": small_ball_range,
            "big_ball_range": big_ball_range
        }
        
        if not state.latest_preview_frame:
            return {
                "small_ball_range": small_ball_range,
                "big_ball_range": big_ball_range,
                "accuracy_score": None,
                "accuracy_label": "Send a preview frame first",
                "ok": True
            }
            
        # Accuracy estimation
        res = detect_ball_in_frame(state.latest_preview_frame, small_ball_range)
        accuracy = 0
        if res.get("detected"):
            accuracy = min(100, int(res["score"] * 100))
            
        if accuracy < 50:
            label = "Poor"
        elif accuracy < 75:
            label = "Fair"
        elif accuracy < 90:
            label = "Good"
        else:
            label = "Excellent"

        logger.info(f"Setup completed for session {x_session_code}. Accuracy: {accuracy}% ({label})")
        return {
            "small_ball_range": small_ball_range,
            "big_ball_range": big_ball_range,
            "accuracy_score": accuracy,
            "accuracy_label": label,
            "ok": True
        }
            
    except Exception as e:
        logger.error(f"Setup failed for session {x_session_code}: {str(e)}")
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})

@app.post("/detect_preview")
async def detect_preview(request: Request, x_session_code: str = Header(None)):
    try:
        if not x_session_code:
            raise ValueError("X-Session-Code header missing")
        state = get_session_by_code(x_session_code)
        if not state:
            raise ValueError("Session not found")
            
        body = await request.body()
        state.latest_preview_frame = body
        
        if not state.hsv_ranges:
            return {"detected": False}
            
        res = detect_ball_in_frame(body, state.hsv_ranges["small_ball_range"])
        return res
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})

@app.post("/frame")
async def save_frame(request: Request, x_session_code: str = Header(None), x_frame_index: str = Header(None)):
    try:
        if not x_session_code or x_frame_index is None:
            raise ValueError("Missing headers")
        state = get_session_by_code(x_session_code)
        if not state:
            raise ValueError("Session not found")
            
        body = await request.body()
        
        frame_idx = int(x_frame_index)
        filename = f"frame_{frame_idx:04d}.jpg"
        filepath = os.path.join(state.frames_dir, filename)
        
        with open(filepath, "wb") as f:
            f.write(body)
            
        state.frame_count += 1
        if state.status != "recording":
            state.status = "recording"
            logger.info(f"Session {x_session_code}: Started receiving frames")
            
        if frame_idx % 50 == 0:
            logger.info(f"Session {x_session_code}: Received {frame_idx} frames")
            
        return {"ok": True, "frame_index": frame_idx}
    except Exception as e:
        logger.error(f"Frame save failed for session {x_session_code} at index {x_frame_index}: {str(e)}")
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})

def run_pipeline(session_code: str):
    state = get_session_by_code(session_code)
    if not state:
        return
        
    try:
        logger.info(f"Starting pipeline analysis for session {session_code}")
        state.progress = 0.0
        state.progress_label = "Validating session..."
        
        if not state.px_per_cm:
            raise ValueError("Calibration not completed")
        if not state.hsv_ranges:
            raise ValueError("Color setup not completed")
        if state.frame_count < MIN_VALID_FRAMES:
            raise ValueError(f"Only {state.frame_count} frames received — minimum {MIN_VALID_FRAMES} required")
            
        logger.info(f"Session {session_code}: Found {state.frame_count} frames on disk. Starting detection...")
        state.progress_label = "Scoring frames..."
        
        frames = []
        filenames = sorted(os.listdir(state.frames_dir))
        for i, fname in enumerate(filenames):
            if fname.endswith(".jpg"):
                filepath = os.path.join(state.frames_dir, fname)
                with open(filepath, "rb") as f:
                    image_bytes = f.read()
                
                res = detect_ball_in_frame(image_bytes, state.hsv_ranges["small_ball_range"])
                if res.get("detected"):
                    frames.append({
                        "frame_index": int(fname.split("_")[1].split(".")[0]),
                        "score": res["score"],
                        "x_px": res["x_px"],
                        "y_px": res["y_px"],
                        "radius_px": res["radius_px"],
                        "filepath": filepath
                    })
            
            state.progress = 0.1 + (0.3 * (i/len(filenames)))
            
        state.progress = 0.4
        state.progress_label = "Selection best frames..."
        
        frames.sort(key=lambda x: x["score"], reverse=True)
        valid_frames = [f for f in frames if f["score"] > MIN_DETECTION_SCORE]
        selected_frames = valid_frames[:TARGET_FRAMES]
        
        if len(selected_frames) < MIN_VALID_FRAMES:
            raise ValueError(f"Only {len(selected_frames)} frames passed detection threshold")
            
        logger.info(f"Session {session_code}: Selected {len(selected_frames)} high-quality frames for analysis.")
        state.progress = 0.5
        state.progress_label = "Extracting coordinates..."
        
        # Get frame dimensions from first selected frame
        np_arr = np.fromfile(selected_frames[0]["filepath"], dtype=np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        frame_height, frame_width = img.shape[:2]
        origin_x = frame_width / 2.0
        origin_y = frame_height / 2.0
        
        coordinates = []
        for f in selected_frames:
            x_cm = (f["x_px"] - origin_x) / state.px_per_cm
            y_cm = (origin_y - f["y_px"]) / state.px_per_cm # Y inverted!
            coordinates.append({
                "x_cm": round(x_cm, 3), 
                "y_cm": round(y_cm, 3), 
                "frame_index": f["frame_index"], 
                "score": round(f["score"], 3)
            })
            
        state.progress = 0.6
        state.progress_label = "Detecting big ball..."
        
        best_bb_score = 0
        best_bb = None
        for f in selected_frames:
            with open(f["filepath"], "rb") as bf:
                bb_bytes = bf.read()
            bb_res = detect_ball_in_frame(bb_bytes, state.hsv_ranges["big_ball_range"])
            if bb_res.get("detected") and bb_res["score"] > best_bb_score:
                best_bb_score = bb_res["score"]
                best_bb = bb_res
                
        big_ball_center = {"x_cm": 0.0, "y_cm": 0.0}
        if best_bb:
            big_ball_center["x_cm"] = round((best_bb["x_px"] - origin_x) / state.px_per_cm, 3)
            big_ball_center["y_cm"] = round((origin_y - best_bb["y_px"]) / state.px_per_cm, 3)

        state.progress = 0.7
        logger.info(f"Session {session_code}: Coordinates extracted. Starting curve fit.")
        fit_result = fit_curves(coordinates)
        logger.info(f"Session {session_code}: Fit complete. Winning curve: {fit_result['winning_curve']}")
        
        state.progress = 0.9
        state.progress_label = "Finalizing..."
        
        try:
            shutil.rmtree(state.frames_dir)
        except Exception:
            pass # ignore cleanup errors on disk
            
        state.progress = 1.0
        state.progress_label = "Done ✓"
        
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        
        run_data = {
            "run_id": f"run_{state.session_code}_{int(time.time())}",
            "session_code": state.session_code,
            "timestamp": timestamp,
            "coordinates": coordinates,
            "big_ball_center": big_ball_center,
            **fit_result
        }
        
        append_run(run_data)
        state.result = run_data
        state.status = "done"
        logger.info(f"Session {session_code}: Pipeline complete. Run {run_data['run_id']} saved.")

    except Exception as e:
        state.status = "error"
        state.error_message = str(e)
        logger.error(f"Pipeline failed for session {session_code}: {str(e)}", exc_info=True)


@app.post("/stop")
async def stop(background_tasks: BackgroundTasks, x_session_code: str = Header(None)):
    try:
        if not x_session_code:
            raise ValueError("X-Session-Code header missing")
        state = get_session_by_code(x_session_code)
        if not state:
            raise ValueError("Session not found")
            
        state.status = "processing"
        logger.info(f"Stop signal received for session {x_session_code}. Adding pipeline to background tasks.")
        background_tasks.add_task(run_pipeline, x_session_code)
        return {"ok": True, "message": "Processing started"}
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})

@app.get("/status")
def get_status(x_session_code: str = Header(None)):
    """
    Check the current status of an experiment session.
    """
    try:
        if not x_session_code:
            # Return idle if no session code provided (avoids 400 error on page load)
            return {"status": "idle", "message": "No active session"}
            
        state = get_session_by_code(x_session_code)
        if not state:
            return {"status": "idle", "message": "Session not found or expired"}
            
        if state.status == "processing":
            return {
                "status": state.status,
                "progress": state.progress,
                "progress_label": state.progress_label
            }
        elif state.status == "done":
             return {
                "status": state.status,
                "run_id": state.result.get("run_id") if state.result else None
            }
        elif state.status == "error":
            return {
                "status": state.status,
                "error": state.error_message
            }
        elif state.status == "recording":
            return {
                "status": state.status,
                "frame_count": state.frame_count
            }
        else:
            return {
                "status": "idle",
                "calibrated": state.px_per_cm is not None,
                "px_per_cm": state.px_per_cm,
                "colors_set": state.hsv_ranges is not None
            }
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})

@app.get("/runs")
def list_runs():
    try:
        return {"runs": get_all_runs()}
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})

@app.get("/runs/{run_id}")
def get_run(run_id: str):
    try:
        run = get_run_by_id(run_id)
        if not run:
             raise ValueError("Run not found")
        return run
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
