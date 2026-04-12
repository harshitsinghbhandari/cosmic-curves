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
from fastapi.responses import JSONResponse, Response, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import qrcode
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm

from session import sessions, SessionState, get_session_by_code, clean_old_sessions
from storage import init_storage, get_all_runs, get_run_by_id, append_run
from calibration import process_calibration_frame, process_calibration_with_markers
from detection import (
    compute_hsv_ranges,
    hough_detect_big_ball,
    distance_mask_detect_small_ball,
    distance_mask_detect_big_ball,
    detect_color_markers,
    MIN_DETECTION_SCORE,
    TARGET_FRAMES,
    MIN_VALID_FRAMES
)
from curve_fitting import fit_curves, draw_physics_overlay
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
    os.makedirs(RUNS_DATA_DIR, exist_ok=True)
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
RUNS_DATA_DIR = os.path.join(DATA_DIR, "runs")

# Ensure directories exist before mounting (mount happens at import time)
os.makedirs(SESSIONS_DATA_DIR, exist_ok=True)
os.makedirs(RUNS_DATA_DIR, exist_ok=True)

# Mount static files directory for runs
app.mount("/data/runs", StaticFiles(directory=RUNS_DATA_DIR), name="runs")




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
        # New unified URL structure: cosmic-curves.vercel.app/phone?session=XXXXXX
        capture_url = f"{base_url}?session={session_code}"
        
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
    """
    Calibrate using two color markers.

    Accepts JSON:
    {
        "marker_color": {"r": 255, "g": 100, "b": 50},
        "marker_distance_cm": 10.0,
        "image": "<base64 JPEG>"
    }

    Returns:
    {
        "ok": true,
        "px_per_cm": 20.5,
        "marker1": {"x_px": 100, "y_px": 200},
        "marker2": {"x_px": 100, "y_px": 400},
        "y_axis": [0, -1],
        "x_axis": [1, 0]
    }
    """
    try:
        if not x_session_code:
            raise ValueError("X-Session-Code header missing")
        state = get_session_by_code(x_session_code)
        if not state:
            raise ValueError("Session not found")

        data = await request.json()
        marker_color = data.get("marker_color", {})
        marker_distance_cm = data.get("marker_distance_cm", 10.0)
        image_base64 = data.get("image", "")

        if not marker_color:
            raise ValueError("marker_color is required")
        if not image_base64:
            raise ValueError("image (base64) is required")

        # Convert RGB to BGR
        marker_bgr = [
            marker_color.get("b", 0),
            marker_color.get("g", 0),
            marker_color.get("r", 0)
        ]

        logger.info(f"[DEBUG] Calibration request - RGB: r={marker_color.get('r')}, g={marker_color.get('g')}, b={marker_color.get('b')}")
        logger.info(f"[DEBUG] Converted to BGR: {marker_bgr}")
        logger.info(f"[DEBUG] Distance: {marker_distance_cm} cm")
        logger.info(f"[DEBUG] Image base64 length: {len(image_base64)}")

        # Decode base64 image
        image_bytes = base64.b64decode(image_base64)
        logger.info(f"[DEBUG] Decoded image bytes: {len(image_bytes)}")

        # Process calibration with markers
        result = process_calibration_with_markers(
            image_bytes,
            marker_bgr,
            float(marker_distance_cm)
        )
        logger.info(f"[DEBUG] Calibration result: {result}")

        # Store calibration data in session
        state.marker_color_bgr = marker_bgr
        state.marker_distance_cm = float(marker_distance_cm)
        state.marker1_px = result["marker1"]
        state.marker2_px = result["marker2"]
        state.y_axis_vector = result["y_axis"]
        state.x_axis_vector = result["x_axis"]
        state.px_per_cm = result["px_per_cm"]

        logger.info(f"Session {x_session_code} calibrated with markers: {result['px_per_cm']:.2f} px/cm")

        return {
            "ok": True,
            "px_per_cm": result["px_per_cm"],
            "marker1": result["marker1"],
            "marker2": result["marker2"],
            "y_axis": result["y_axis"],
            "x_axis": result["x_axis"]
        }
    except Exception as e:
        logger.error(f"Calibration failed for session {x_session_code}: {str(e)}")
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})

@app.post("/setup")
async def setup(request: Request, x_session_code: str = Header(None)):
    """
    Set ball colors for detection.

    Accepts JSON (both optional, at least one required):
    {
        "small_ball_color": {"r": 167, "g": 235, "b": 156},
        "big_ball_color": {"r": 200, "g": 100, "b": 50}
    }

    Returns:
    {
        "ok": true,
        "small_ball_bgr": [156, 235, 167],
        "big_ball_bgr": [50, 100, 200]
    }
    """
    try:
        if not x_session_code:
            raise ValueError("X-Session-Code header missing")
        state = get_session_by_code(x_session_code)
        if not state:
            raise ValueError("Session not found")

        data = await request.json()
        small_ball_color = data.get("small_ball_color")
        big_ball_color = data.get("big_ball_color")

        if not small_ball_color and not big_ball_color:
            raise ValueError("At least one of small_ball_color or big_ball_color is required")

        result = {"ok": True}

        # Set small ball color if provided
        if small_ball_color:
            small_ball_bgr = [
                small_ball_color.get("b", 0),
                small_ball_color.get("g", 0),
                small_ball_color.get("r", 0)
            ]
            state.small_ball_bgr = small_ball_bgr
            result["small_ball_bgr"] = small_ball_bgr
            logger.info(f"Session {x_session_code}: Small ball BGR set to {small_ball_bgr}")

        # Set big ball color if provided
        if big_ball_color:
            big_ball_bgr = [
                big_ball_color.get("b", 0),
                big_ball_color.get("g", 0),
                big_ball_color.get("r", 0)
            ]
            state.big_ball_bgr = big_ball_bgr
            result["big_ball_bgr"] = big_ball_bgr
            logger.info(f"Session {x_session_code}: Big ball BGR set to {big_ball_bgr}")

        return result

    except Exception as e:
        logger.error(f"Setup failed for session {x_session_code}: {str(e)}")
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})

@app.post("/detect_preview")
async def detect_preview(request: Request, x_session_code: str = Header(None)):
    """
    Detect small ball in preview frame for live feedback.
    Stores the frame for later use.
    """
    try:
        if not x_session_code:
            raise ValueError("X-Session-Code header missing")
        state = get_session_by_code(x_session_code)
        if not state:
            raise ValueError("Session not found")

        body = await request.body()
        state.latest_preview_frame = body

        if not state.small_ball_bgr:
            return {"detected": False, "message": "Small ball color not set"}

        # Use distance masking for live preview feedback
        return distance_mask_detect_small_ball(body, target_bgr=state.small_ball_bgr)
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})


@app.post("/test_detection")
async def test_detection(request: Request, x_session_code: str = Header(None)):
    """
    Test detection on current frame and return annotated image.

    Returns:
    {
        "small_ball": {"detected": true, "x_px": 300, "y_px": 250, "score": 0.85},
        "big_ball": {"detected": true, "x_px": 400, "y_px": 300},
        "annotated_image": "<base64 JPEG>",
        "success": true
    }
    """
    try:
        if not x_session_code:
            raise ValueError("X-Session-Code header missing")
        state = get_session_by_code(x_session_code)
        if not state:
            raise ValueError("Session not found")

        body = await request.body()
        state.latest_preview_frame = body

        if not state.small_ball_bgr:
            raise ValueError("Small ball color not set - complete setup first")
        if not state.is_calibrated():
            raise ValueError("Calibration not complete - detect markers first")

        # Detect small ball
        small_ball_result = distance_mask_detect_small_ball(body, target_bgr=state.small_ball_bgr)

        # Detect big ball - use color-based if big_ball_bgr is set, otherwise fallback to Hough
        if state.big_ball_bgr:
            big_ball_result = distance_mask_detect_big_ball(body, target_bgr=state.big_ball_bgr)
        else:
            big_ball_result = hough_detect_big_ball(body)

        # Create annotated image
        np_arr = np.frombuffer(body, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        if img is not None:
            # Draw big ball (magenta circle + white cross = origin)
            if big_ball_result.get("detected"):
                bb_x = big_ball_result["x_px"]
                bb_y = big_ball_result["y_px"]
                bb_r = big_ball_result.get("radius_px", 50)

                # Magenta circle around big ball
                cv2.circle(img, (bb_x, bb_y), bb_r, (255, 0, 255), 3)

                # White cross at center (origin marker)
                cross_size = 20
                cv2.line(img, (bb_x - cross_size, bb_y), (bb_x + cross_size, bb_y), (255, 255, 255), 2)
                cv2.line(img, (bb_x, bb_y - cross_size), (bb_x, bb_y + cross_size), (255, 255, 255), 2)

                # Draw coordinate axes from big ball center
                axis_length = 100
                if state.y_axis_vector and state.x_axis_vector:
                    # Y-axis (green, pointing up)
                    y_end_x = int(bb_x + state.y_axis_vector[0] * axis_length)
                    y_end_y = int(bb_y + state.y_axis_vector[1] * axis_length)
                    cv2.arrowedLine(img, (bb_x, bb_y), (y_end_x, y_end_y), (0, 255, 0), 2, tipLength=0.2)
                    cv2.putText(img, "Y", (y_end_x + 5, y_end_y - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

                    # X-axis (red, perpendicular)
                    x_end_x = int(bb_x + state.x_axis_vector[0] * axis_length)
                    x_end_y = int(bb_y + state.x_axis_vector[1] * axis_length)
                    cv2.arrowedLine(img, (bb_x, bb_y), (x_end_x, x_end_y), (0, 0, 255), 2, tipLength=0.2)
                    cv2.putText(img, "X", (x_end_x + 5, x_end_y - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)

                # Origin label
                cv2.putText(img, "(0,0)", (bb_x + 10, bb_y + 30), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

            # Draw small ball (green circle)
            if small_ball_result.get("detected"):
                sb_x = small_ball_result["x_px"]
                sb_y = small_ball_result["y_px"]
                sb_r = small_ball_result.get("radius_px", 10)

                # Score-based color
                score = small_ball_result.get("score", 0.5)
                if score > 0.75:
                    color = (0, 255, 0)  # Green
                elif score > 0.5:
                    color = (0, 255, 255)  # Yellow
                else:
                    color = (0, 0, 255)  # Red

                cv2.circle(img, (sb_x, sb_y), sb_r + 5, color, 3)

                # Score label
                cv2.putText(img, f"{score:.2f}", (sb_x + sb_r + 5, sb_y), cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)

            # Encode annotated image to base64
            _, buffer = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 90])
            annotated_base64 = base64.b64encode(buffer).decode('utf-8')
        else:
            annotated_base64 = ""

        success = small_ball_result.get("detected", False) and big_ball_result.get("detected", False)

        return {
            "small_ball": small_ball_result,
            "big_ball": big_ball_result,
            "annotated_image": annotated_base64,
            "success": success
        }

    except Exception as e:
        logger.error(f"Test detection failed for session {x_session_code}: {str(e)}")
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
        state.add_log(f"Starting pipeline analysis")
        state.progress = 0.0
        state.progress_label = "Validating session..."
        state.debug_logs = []  # Clear previous logs
        state.all_frame_results = []  # Clear previous results

        # Create debug frames directory
        debug_dir = os.path.join(state.frames_dir, "..", "debug_frames")
        os.makedirs(debug_dir, exist_ok=True)
        state.debug_frames_dir = debug_dir
        state.add_log(f"Debug frames dir: {debug_dir}")

        if not state.px_per_cm:
            raise ValueError("Calibration not completed")
        if not state.small_ball_bgr:
            raise ValueError("Small ball color not set")
        if state.frame_count < MIN_VALID_FRAMES:
            raise ValueError(f"Only {state.frame_count} frames received — minimum {MIN_VALID_FRAMES} required")

        state.add_log(f"Small ball BGR target: {state.small_ball_bgr}")
        state.add_log(f"Calibration: {state.px_per_cm:.2f} px/cm")
        logger.info(f"Session {session_code}: Found {state.frame_count} frames on disk. Starting detection...")
        state.add_log(f"Found {state.frame_count} frames. Starting detection...")
        state.progress_label = "Scoring frames & generating debug images..."

        frames = []
        all_frame_results = []  # Store ALL frame detection results for debug
        filenames = sorted(os.listdir(state.frames_dir))

        for i, fname in enumerate(filenames):
            if fname.endswith(".jpg"):
                filepath = os.path.join(state.frames_dir, fname)
                with open(filepath, "rb") as f:
                    image_bytes = f.read()

                frame_idx = int(fname.split("_")[1].split(".")[0])

                # Track the small ball using specialized distance masking with session color
                res = distance_mask_detect_small_ball(image_bytes, target_bgr=state.small_ball_bgr)

                # Detect big ball - use color-based if big_ball_bgr is set, otherwise fallback to Hough
                if state.big_ball_bgr:
                    bb_res = distance_mask_detect_big_ball(image_bytes, target_bgr=state.big_ball_bgr)
                else:
                    bb_res = hough_detect_big_ball(image_bytes)

                # Store ALL results for debug view with comprehensive details
                small_radius = res.get("radius_px", 0)
                small_area = res.get("area", int(3.14159 * small_radius * small_radius) if small_radius > 0 else 0)
                big_radius = bb_res.get("radius_px", 0)
                big_area = bb_res.get("area", int(3.14159 * big_radius * big_radius) if big_radius > 0 else 0)

                frame_result = {
                    "frame_index": frame_idx,
                    # Small ball detection
                    "detected": res.get("detected", False),
                    "score": round(res.get("score", 0), 3) if res.get("detected") else 0,
                    "small_x": res.get("x_px", 0),
                    "small_y": res.get("y_px", 0),
                    "small_radius": small_radius,
                    "small_area": small_area,
                    # Big ball detection
                    "big_detected": bb_res.get("detected", False),
                    "big_score": round(bb_res.get("score", 0), 3) if bb_res.get("detected") else 0,
                    "big_x": bb_res.get("x_px", 0),
                    "big_y": bb_res.get("y_px", 0),
                    "big_radius": big_radius,
                    "big_area": big_area,
                    # Distance between balls (if both detected)
                    "distance_px": 0,
                }

                # Calculate distance between balls if both detected
                if res.get("detected") and bb_res.get("detected"):
                    dx = res["x_px"] - bb_res["x_px"]
                    dy = res["y_px"] - bb_res["y_px"]
                    frame_result["distance_px"] = int((dx*dx + dy*dy) ** 0.5)

                all_frame_results.append(frame_result)

                # Generate annotated debug frame for EVERY frame
                np_arr = np.frombuffer(image_bytes, np.uint8)
                img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
                if img is not None:
                    h, w = img.shape[:2]

                    # Draw big ball if detected (color based on score)
                    if bb_res.get("detected"):
                        bb_x, bb_y = bb_res["x_px"], bb_res["y_px"]
                        bb_r = bb_res.get("radius_px", 50)
                        bb_score = bb_res.get("score", 1.0)
                        # Magenta color with intensity based on score
                        if bb_score > 0.6:
                            bb_color = (255, 0, 255)  # Bright magenta
                        elif bb_score > 0.3:
                            bb_color = (200, 0, 200)  # Medium magenta
                        else:
                            bb_color = (150, 0, 150)  # Dim magenta
                        cv2.circle(img, (bb_x, bb_y), bb_r, bb_color, 3)
                        cv2.putText(img, f"BIG {bb_score:.2f}", (bb_x - 30, bb_y - bb_r - 10),
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, bb_color, 2)
                    else:
                        cv2.putText(img, "NO BIG BALL", (10, 60),
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, (150, 0, 150), 2)

                    # Draw small ball detection (color based on score)
                    if res.get("detected"):
                        sb_x, sb_y = res["x_px"], res["y_px"]
                        sb_r = res.get("radius_px", 15)
                        score = res.get("score", 0)
                        # Green if good, yellow if medium, red if poor
                        if score > 0.6:
                            color = (0, 255, 0)
                        elif score > 0.4:
                            color = (0, 255, 255)
                        else:
                            color = (0, 0, 255)
                        cv2.circle(img, (sb_x, sb_y), sb_r + 5, color, 3)
                        cv2.putText(img, f"SMALL {score:.2f}", (sb_x - 40, sb_y - sb_r - 10),
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
                    else:
                        # No detection - draw red X
                        cv2.putText(img, "NO SMALL BALL", (10, 30),
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)

                    # Add frame info overlay with both scores
                    small_score_str = f"S:{frame_result['score']:.2f}" if frame_result['detected'] else "S:--"
                    big_score_str = f"B:{frame_result['big_score']:.2f}" if frame_result['big_detected'] else "B:--"
                    info_text = f"#{frame_idx} | {small_score_str} | {big_score_str}"
                    cv2.putText(img, info_text, (10, h - 20),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

                    # Save debug frame
                    debug_path = os.path.join(debug_dir, f"debug_{frame_idx:04d}.jpg")
                    cv2.imwrite(debug_path, img, [cv2.IMWRITE_JPEG_QUALITY, 85])

                if res.get("detected"):
                    frames.append({
                        "frame_index": frame_idx,
                        "score": res.get("score", 0.5),
                        "x_px": res["x_px"],
                        "y_px": res["y_px"],
                        "radius_px": res["radius_px"],
                        "filepath": filepath
                    })

            state.progress = 0.1 + (0.3 * (i/len(filenames)))

        # Store all frame results in session state for frontend access
        state.all_frame_results = all_frame_results

        detected_count = len([f for f in all_frame_results if f["detected"]])
        scores = [f["score"] for f in all_frame_results if f["detected"]]
        state.add_log(f"Detection complete: {detected_count}/{len(all_frame_results)} frames detected small ball")
        if scores:
            state.add_log(f"Score range: min={min(scores):.3f}, max={max(scores):.3f}, avg={sum(scores)/len(scores):.3f}")
        else:
            state.add_log(f"WARNING: No frames with detected=True")

        state.progress = 0.4
        state.progress_label = "Selecting best frames..."

        frames.sort(key=lambda x: x["score"], reverse=True)
        valid_frames = [f for f in frames if f["score"] > MIN_DETECTION_SCORE]
        selected_frames = valid_frames[:TARGET_FRAMES]

        state.add_log(f"Frames with score > {MIN_DETECTION_SCORE}: {len(valid_frames)}")
        state.add_log(f"Selected top frames: {len(selected_frames)}")

        if len(selected_frames) < MIN_VALID_FRAMES:
            # Don't raise immediately - provide debug info
            state.add_log(f"ERROR: Only {len(selected_frames)} frames passed threshold (need {MIN_VALID_FRAMES})")
            state.add_log(f"Score distribution: {[f['score'] for f in all_frame_results[:20]]}")
            raise ValueError(f"Only {len(selected_frames)} frames passed detection threshold. Check debug frames at /session/debug")

        logger.info(f"Session {session_code}: Selected {len(selected_frames)} high-quality frames for analysis.")
        state.progress = 0.5
        state.progress_label = "Detecting big ball (origin)..."

        # Get frame dimensions from first selected frame
        np_arr = np.fromfile(selected_frames[0]["filepath"], dtype=np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        frame_height, frame_width = img.shape[:2]

        # Detect big ball to use as origin (0,0)
        best_bb = None
        for f in selected_frames:
            with open(f["filepath"], "rb") as bf:
                bb_bytes = bf.read()
            bb_res = hough_detect_big_ball(bb_bytes)
            if bb_res.get("detected"):
                best_bb = bb_res
                break

        # Define origin: big ball center if found, else frame center
        if best_bb:
            origin_x = best_bb["x_px"]
            origin_y = best_bb["y_px"]
            logger.info(f"Session {session_code}: Big ball detected at ({origin_x}, {origin_y}) - using as origin")
        else:
            origin_x = frame_width / 2.0
            origin_y = frame_height / 2.0
            logger.warning(f"Session {session_code}: Big ball not detected - using frame center as origin")

        state.progress = 0.6
        state.progress_label = "Extracting coordinates..."

        # Get axis vectors from calibration (if available)
        y_axis = state.y_axis_vector if state.y_axis_vector else [0, -1]  # Default: up
        x_axis = state.x_axis_vector if state.x_axis_vector else [1, 0]   # Default: right

        # Transform coordinates using calibration axes with big ball as origin
        coordinates = []
        for f in selected_frames:
            # Relative position from origin (in pixels)
            rel_px_x = f["x_px"] - origin_x
            rel_px_y = f["y_px"] - origin_y

            # Project onto calibration axes (dot product)
            # Note: Y is inverted because pixel Y increases downward
            x_cm = (rel_px_x * x_axis[0] + rel_px_y * x_axis[1]) / state.px_per_cm
            y_cm = -(rel_px_x * y_axis[0] + rel_px_y * y_axis[1]) / state.px_per_cm

            coordinates.append({
                "x_cm": round(x_cm, 3),
                "y_cm": round(y_cm, 3),
                "frame_index": f["frame_index"],
                "score": round(f["score"], 3)
            })

        state.progress = 0.7
        state.progress_label = "Fitting curves..."
        logger.info(f"Session {session_code}: Coordinates extracted. Starting curve fit.")

        # Perform curve fitting
        fit_result = fit_curves(coordinates)
        logger.info(f"Session {session_code}: Fit complete. Winning curve: {fit_result['winning_curve']}")

        # --- Run directory and annotated frames ---
        run_id = f"run_{state.session_code}_{int(time.time())}"
        run_dir = os.path.join(RUNS_DATA_DIR, run_id)
        frames_output_dir = os.path.join(run_dir, "frames")
        os.makedirs(frames_output_dir, exist_ok=True)

        state.progress = 0.75
        state.progress_label = "Generating annotated frames..."

        # Select up to 30 frames evenly spaced for annotation
        annotated_frame_urls = []
        max_annotated = 30
        step = max(1, len(selected_frames) // max_annotated)
        frames_to_annotate = selected_frames[::step][:max_annotated]

        for idx, f in enumerate(frames_to_annotate):
            try:
                frame_img = cv2.imread(f["filepath"])
                if frame_img is None:
                    continue

                # Draw big ball (origin) - magenta circle + white cross
                if best_bb:
                    bb_x, bb_y = int(origin_x), int(origin_y)
                    bb_r = best_bb.get("radius_px", 50)

                    cv2.circle(frame_img, (bb_x, bb_y), bb_r, (255, 0, 255), 2)
                    cross_size = 15
                    cv2.line(frame_img, (bb_x - cross_size, bb_y), (bb_x + cross_size, bb_y), (255, 255, 255), 2)
                    cv2.line(frame_img, (bb_x, bb_y - cross_size), (bb_x, bb_y + cross_size), (255, 255, 255), 2)

                    # Draw X/Y axis arrows from origin
                    axis_length = 80
                    y_end = (int(bb_x + y_axis[0] * axis_length), int(bb_y + y_axis[1] * axis_length))
                    x_end = (int(bb_x + x_axis[0] * axis_length), int(bb_y + x_axis[1] * axis_length))

                    cv2.arrowedLine(frame_img, (bb_x, bb_y), y_end, (0, 255, 0), 2, tipLength=0.15)
                    cv2.putText(frame_img, "Y", (y_end[0] + 5, y_end[1]), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)

                    cv2.arrowedLine(frame_img, (bb_x, bb_y), x_end, (0, 0, 255), 2, tipLength=0.15)
                    cv2.putText(frame_img, "X", (x_end[0] + 5, x_end[1]), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)

                    cv2.putText(frame_img, "(0,0)", (bb_x + 10, bb_y + 25), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)

                # Draw small ball - green circle
                sb_x, sb_y = f["x_px"], f["y_px"]
                sb_r = f.get("radius_px", 10)
                score = f.get("score", 0.5)

                if score > 0.75:
                    color = (0, 255, 0)
                elif score > 0.5:
                    color = (0, 255, 255)
                else:
                    color = (0, 0, 255)

                cv2.circle(frame_img, (sb_x, sb_y), sb_r + 5, color, 2)

                # Coordinate label for small ball
                coord_idx = next((i for i, c in enumerate(coordinates) if c["frame_index"] == f["frame_index"]), None)
                if coord_idx is not None:
                    coord = coordinates[coord_idx]
                    label = f"({coord['x_cm']:.1f}, {coord['y_cm']:.1f})"
                    cv2.putText(frame_img, label, (sb_x + sb_r + 5, sb_y - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.35, color, 1)

                # Save annotated frame
                frame_filename = f"frame_{f['frame_index']:04d}.jpg"
                frame_path = os.path.join(frames_output_dir, frame_filename)
                cv2.imwrite(frame_path, frame_img)
                annotated_frame_urls.append(f"/data/runs/{run_id}/frames/{frame_filename}")

            except Exception as frame_err:
                logger.warning(f"Failed to annotate frame {f['frame_index']}: {frame_err}")

        state.progress = 0.85
        state.progress_label = "Generating visualization..."

        # --- Main Visualization Generation ---
        try:
            middle_f = selected_frames[len(selected_frames)//2]
            img_bg = cv2.imread(middle_f["filepath"])
            if img_bg is not None:
                draw_physics_overlay(img_bg, fit_result, origin_x, origin_y, state.px_per_cm, coordinates)
                viz_path = os.path.join(run_dir, "visualization.jpg")
                cv2.imwrite(viz_path, img_bg)
                logger.info(f"Session {session_code}: Trajectory visualization saved to {viz_path}")
        except Exception as k:
            logger.error(f"Failed to generate visualization for {session_code}: {str(k)}")

        state.progress = 0.9
        state.progress_label = "Finalizing..."

        # Cleanup temporary frames
        try:
            shutil.rmtree(state.frames_dir)
        except Exception:
            pass

        state.progress = 1.0
        state.progress_label = "Done"

        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        # Calculate detailed statistics
        detected_count = len([f for f in all_frame_results if f["detected"]])
        scores = [f["score"] for f in all_frame_results if f["detected"]]
        avg_score = round(sum(scores) / len(scores), 3) if scores else 0
        min_score = round(min(scores), 3) if scores else 0
        max_score = round(max(scores), 3) if scores else 0

        # Get all curve fit details
        all_curves = {}
        for curve_type in ["parabola", "ellipse", "hyperbola"]:
            if curve_type in fit_result.get("residuals", {}):
                all_curves[curve_type] = {
                    "residual": fit_result["residuals"][curve_type],
                    "is_winner": curve_type == fit_result["winning_curve"]
                }

        # Big ball center is now (0,0) by definition
        big_ball_center = {"x_cm": 0.0, "y_cm": 0.0}

        run_data = {
            "run_id": run_id,
            "session_code": state.session_code,
            "timestamp": timestamp,
            "coordinates": coordinates,
            "big_ball_center": big_ball_center,
            "visualization_url": f"/data/runs/{run_id}/visualization.jpg",
            "annotated_frames": annotated_frame_urls,
            # Detailed stats
            "stats": {
                "total_frames": len(all_frame_results),
                "detected_frames": detected_count,
                "selected_frames": len(selected_frames),
                "rejected_frames": detected_count - len(selected_frames),
                "detection_rate": round(detected_count / len(all_frame_results) * 100, 1) if all_frame_results else 0,
                "avg_score": avg_score,
                "min_score": min_score,
                "max_score": max_score,
                "px_per_cm": round(state.px_per_cm, 2),
                "frame_dimensions": {"width": frame_width, "height": frame_height},
                "origin": {"x": origin_x, "y": origin_y},
                "origin_source": "big_ball" if best_bb else "frame_center"
            },
            # All frame detection results for debug view
            "all_frames": all_frame_results,
            # All curve fits
            "all_curves": all_curves,
            **fit_result
        }

        append_run(run_data)
        state.result = run_data
        state.status = "done"
        logger.info(f"Session {session_code}: Pipeline complete. Run {run_data['run_id']} saved with {len(annotated_frame_urls)} annotated frames.")

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
                "calibrated": state.is_calibrated(),
                "px_per_cm": state.px_per_cm,
                "colors_set": state.small_ball_bgr is not None,
                "setup_complete": state.is_setup_complete()
            }
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})

@app.get("/session/frames")
def get_session_frames(x_session_code: str = Header(...)):
    """
    Get list of available frame indices for the current session.
    Returns the most recent N frame indices for preview.
    """
    try:
        state = get_session_by_code(x_session_code)
        if not state.frames_dir or not os.path.exists(state.frames_dir):
            return {"frames": [], "total": 0}

        filenames = sorted([f for f in os.listdir(state.frames_dir) if f.endswith(".jpg")])
        indices = [int(f.split("_")[1].split(".")[0]) for f in filenames]

        # Return last 20 frames for preview
        recent = indices[-20:] if len(indices) > 20 else indices

        return {
            "frames": recent,
            "total": len(indices)
        }
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})

@app.get("/session/frame/{index}")
def get_frame_by_index(index: int, session: str = None, x_session_code: str = Header(None)):
    """
    Serve a specific frame image from the current session.
    Accepts session code via query param or header.
    """
    try:
        code = session or x_session_code
        if not code:
            raise ValueError("Session code required")

        state = get_session_by_code(code)
        if not state.frames_dir:
            raise ValueError("No frames directory")

        filename = f"frame_{index:04d}.jpg"
        filepath = os.path.join(state.frames_dir, filename)

        if not os.path.exists(filepath):
            raise ValueError(f"Frame {index} not found")

        return FileResponse(filepath, media_type="image/jpeg")
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})

@app.get("/session/debug")
def get_debug_info(x_session_code: str = Header(...)):
    """
    Get debug info including logs, frame results, and available debug frames.
    """
    try:
        state = get_session_by_code(x_session_code)
        if not state:
            raise ValueError("Session not found")

        debug_frames = []
        if state.debug_frames_dir and os.path.exists(state.debug_frames_dir):
            debug_frames = sorted([
                int(f.split("_")[1].split(".")[0])
                for f in os.listdir(state.debug_frames_dir)
                if f.startswith("debug_") and f.endswith(".jpg")
            ])

        return {
            "logs": state.debug_logs,
            "frame_results": state.all_frame_results,
            "debug_frame_indices": debug_frames,
            "small_ball_bgr": state.small_ball_bgr,
            "big_ball_bgr": state.big_ball_bgr,
            "px_per_cm": state.px_per_cm,
            "status": state.status,
            "progress": state.progress,
            "progress_label": state.progress_label,
            "error": state.error_message
        }
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})

@app.get("/session/debug/frame/{index}")
def get_debug_frame(index: int, session: str = None, x_session_code: str = Header(None)):
    """
    Serve an annotated debug frame image.
    """
    try:
        code = session or x_session_code
        if not code:
            raise ValueError("Session code required")

        state = get_session_by_code(code)
        if not state or not state.debug_frames_dir:
            raise ValueError("Debug frames not available")

        filename = f"debug_{index:04d}.jpg"
        filepath = os.path.join(state.debug_frames_dir, filename)

        if not os.path.exists(filepath):
            raise ValueError(f"Debug frame {index} not found")

        return FileResponse(filepath, media_type="image/jpeg")
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

@app.post("/debug/test-pipeline")
async def debug_test_pipeline(background_tasks: BackgroundTasks):
    """
    Automated end-to-end test using real video file (IMG_0982.MOV).
    Extracts frames from 25s mark, simulates setup, and triggers analysis.
    """
    try:
        # 1. Create a fresh session
        session_code = "TESTER"
        session_id = f"debug_{session_code}"
        frames_dir = os.path.join(SESSIONS_DATA_DIR, session_id, "frames")

        if session_id in sessions:
            # Cleanup existing if present
            try:
                shutil.rmtree(sessions[session_id].frames_dir)
            except:
                pass

        os.makedirs(frames_dir, exist_ok=True)
        state = SessionState(
            session_id=session_id,
            session_code=session_code,
            frames_dir=frames_dir
        )
        sessions[session_id] = state

        # 2. Extract frames from the real video
        video_path = "IMG_0982.MOV"
        if not os.path.exists(video_path):
            return JSONResponse(status_code=404, content={"ok": False, "error": f"{video_path} not found"})

        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS)
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(25.0 * fps))

        logger.info(f"Debug: Extracting 60 frames from {video_path} for testing...")

        extracted = 0
        for i in range(60):
            ret, frame = cap.read()
            if not ret:
                break

            # Save frame to the session directory
            fname = f"frame_{i:04d}.jpg"
            filepath = os.path.join(state.frames_dir, fname)
            cv2.imwrite(filepath, frame)
            extracted += 1
            state.frame_count = extracted

        cap.release()

        if extracted < 10:
            return {"ok": False, "error": "Insufficient frames extracted"}

        # 3. Simulate Setup Phase with new fields
        state.px_per_cm = 20.0  # Standard guestimate
        state.y_axis_vector = [0, -1]  # Standard up direction
        state.x_axis_vector = [1, 0]   # Standard right direction
        state.small_ball_bgr = [156, 235, 167]  # Default green #a7eb9c
        state.status = "processing"

        # 4. Fire the real production pipeline
        background_tasks.add_task(run_pipeline, session_code)

        return {
            "ok": True,
            "session_code": session_code,
            "frames_extracted": extracted,
            "message": "Automated pipeline triggered. Keep polling /status with header X-Session-Code: TESTER"
        }

    except Exception as e:
        logger.error(f"Debug Pipeline Error: {str(e)}")
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
