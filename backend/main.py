"""
CosmosCurves - Unified Ball Trajectory Tracker Backend

Simplified FastAPI backend for the unified app.
Handles calibration, ball detection, curve fitting, and results storage.
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
from fastapi import FastAPI, Header, HTTPException, Request, BackgroundTasks, File, UploadFile
from fastapi.responses import JSONResponse, Response, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import tempfile

from session import sessions, SessionState, get_session_by_code, clean_old_sessions, set_session
from storage import init_storage, get_all_runs, get_run_by_id, append_run
from calibration import process_calibration_with_markers
from detection import (
    hough_detect_big_ball,
    distance_mask_detect_small_ball,
    distance_mask_detect_big_ball,
    MIN_DETECTION_SCORE,
    TARGET_FRAMES,
    MIN_VALID_FRAMES
)
from curve_fitting import fit_curves, draw_physics_overlay

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

# Directory paths for data storage
current_dir = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(current_dir, "data")
SESSIONS_DATA_DIR = os.path.join(DATA_DIR, "sessions")
RUNS_DATA_DIR = os.path.join(DATA_DIR, "runs")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown events."""
    init_storage()
    os.makedirs(SESSIONS_DATA_DIR, exist_ok=True)
    os.makedirs(RUNS_DATA_DIR, exist_ok=True)
    logger.info("CosmosCurves backend started.")
    yield
    logger.info("Backend shutting down.")

# Initialize FastAPI application
app = FastAPI(
    title="CosmosCurves",
    description="Ball Trajectory Tracker API",
    version="2.0.0",
    docs_url="/docs",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Session-Code", "X-Frame-Index"],
    expose_headers=["X-Session-Code"],
)

# Ensure directories exist
os.makedirs(SESSIONS_DATA_DIR, exist_ok=True)
os.makedirs(RUNS_DATA_DIR, exist_ok=True)

# Mount static files for runs
app.mount("/data/runs", StaticFiles(directory=RUNS_DATA_DIR), name="runs")


@app.post("/session/new")
def new_session():
    """Create a new session for tracking."""
    try:
        clean_old_sessions()

        session_id = str(uuid.uuid4())
        session_code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

        frames_dir = os.path.join(SESSIONS_DATA_DIR, session_id, "frames")
        os.makedirs(frames_dir, exist_ok=True)

        state = SessionState(
            session_id=session_id,
            session_code=session_code,
            frames_dir=frames_dir
        )
        set_session(session_id, state)

        logger.info(f"New session created: {session_code}")

        return {
            "session_code": session_code,
            "session_id": session_id
        }
    except Exception as e:
        logger.error(f"Failed to create session: {str(e)}")
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})


@app.post("/calibrate")
async def calibrate(request: Request, x_session_code: str = Header(None)):
    """
    Calibrate using two color markers.

    Body: {
        "marker_color": {"r": 255, "g": 100, "b": 50},
        "marker_distance_cm": 10.0,
        "image": "<base64 JPEG>"
    }
    """
    try:
        if not x_session_code:
            raise ValueError("X-Session-Code header required")
        state = get_session_by_code(x_session_code)
        if not state:
            raise ValueError("Session not found")

        data = await request.json()
        marker_color = data.get("marker_color", {})
        marker_distance_cm = data.get("marker_distance_cm", 10.0)
        image_base64 = data.get("image", "")

        if not marker_color or not image_base64:
            raise ValueError("marker_color and image are required")

        marker_bgr = [
            marker_color.get("b", 0),
            marker_color.get("g", 0),
            marker_color.get("r", 0)
        ]

        image_bytes = base64.b64decode(image_base64)
        result = process_calibration_with_markers(
            image_bytes, marker_bgr, float(marker_distance_cm)
        )

        # Store calibration
        state.marker_color_bgr = marker_bgr
        state.marker_distance_cm = float(marker_distance_cm)
        state.marker1_px = result["marker1"]
        state.marker2_px = result["marker2"]
        state.y_axis_vector = result["y_axis"]
        state.x_axis_vector = result["x_axis"]
        state.px_per_cm = result["px_per_cm"]

        logger.info(f"Session {x_session_code} calibrated: {result['px_per_cm']:.2f} px/cm")

        return {
            "ok": True,
            "px_per_cm": result["px_per_cm"],
            "marker1": result["marker1"],
            "marker2": result["marker2"],
            "y_axis": result["y_axis"],
            "x_axis": result["x_axis"],
            "size_warning": result.get("size_warning"),
            "annotated_image": result.get("annotated_image")
        }
    except Exception as e:
        logger.error(f"Calibration failed: {str(e)}")
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})


@app.post("/setup")
async def setup(request: Request, x_session_code: str = Header(None)):
    """
    Set ball colors for detection.

    Body: {
        "small_ball_color": {"r": 167, "g": 235, "b": 156},
        "big_ball_color": {"r": 200, "g": 100, "b": 50}  // optional
    }
    """
    try:
        if not x_session_code:
            raise ValueError("X-Session-Code header required")
        state = get_session_by_code(x_session_code)
        if not state:
            raise ValueError("Session not found")

        data = await request.json()
        small_ball_color = data.get("small_ball_color")
        big_ball_color = data.get("big_ball_color")

        result = {"ok": True}

        if small_ball_color:
            state.small_ball_bgr = [
                small_ball_color.get("b", 0),
                small_ball_color.get("g", 0),
                small_ball_color.get("r", 0)
            ]
            result["small_ball_bgr"] = state.small_ball_bgr

        if big_ball_color:
            state.big_ball_bgr = [
                big_ball_color.get("b", 0),
                big_ball_color.get("g", 0),
                big_ball_color.get("r", 0)
            ]
            result["big_ball_bgr"] = state.big_ball_bgr

        return result
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})


@app.post("/frame")
async def save_frame(request: Request, x_session_code: str = Header(None), x_frame_index: str = Header(None)):
    """Save a frame during recording."""
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

        return {"ok": True, "frame_index": frame_idx}
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})


@app.post("/upload-video")
async def upload_video(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    x_session_code: str = Header(None)
):
    """
    Upload a video file and extract frames for processing.
    """
    try:
        if not x_session_code:
            raise ValueError("X-Session-Code header required")
        state = get_session_by_code(x_session_code)
        if not state:
            raise ValueError("Session not found")

        if not state.px_per_cm:
            raise ValueError("Calibration not completed")
        if not state.small_ball_bgr:
            raise ValueError("Small ball color not set")

        # Save uploaded video to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as tmp:
            content = await video.read()
            tmp.write(content)
            tmp_path = tmp.name

        logger.info(f"Video uploaded: {video.filename}, size: {len(content)} bytes")

        # Extract frames from video
        cap = cv2.VideoCapture(tmp_path)
        if not cap.isOpened():
            os.unlink(tmp_path)
            raise ValueError("Could not open video file")

        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        logger.info(f"Video: {fps} FPS, {total_frames} total frames")

        # Extract frames at ~15 FPS
        target_fps = 15
        frame_interval = max(1, int(fps / target_fps))

        frame_idx = 0
        extracted = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx % frame_interval == 0:
                filename = f"frame_{extracted:04d}.jpg"
                filepath = os.path.join(state.frames_dir, filename)
                cv2.imwrite(filepath, frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                extracted += 1

            frame_idx += 1

        cap.release()
        os.unlink(tmp_path)  # Clean up temp file

        state.frame_count = extracted
        logger.info(f"Extracted {extracted} frames from video")

        if extracted < MIN_VALID_FRAMES:
            raise ValueError(f"Video too short: only {extracted} frames extracted (need {MIN_VALID_FRAMES})")

        # Start processing
        state.status = "processing"
        background_tasks.add_task(run_pipeline, x_session_code)

        return {"ok": True, "message": "Processing started", "frame_count": extracted}

    except Exception as e:
        logger.error(f"Video upload failed: {str(e)}")
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})


def run_pipeline(session_code: str):
    """Run the detection and curve fitting pipeline."""
    state = get_session_by_code(session_code)
    if not state:
        return

    try:
        logger.info(f"Starting pipeline for session {session_code}")
        state.progress = 0.0
        state.progress_label = "Validating..."

        # Validation
        if not state.px_per_cm:
            raise ValueError("Calibration not completed")
        if not state.small_ball_bgr:
            raise ValueError("Small ball color not set")
        if state.frame_count < MIN_VALID_FRAMES:
            raise ValueError(f"Need at least {MIN_VALID_FRAMES} frames")

        state.progress = 0.1
        state.progress_label = "Detecting balls..."

        # Create gallery directory for this session
        gallery_dir = os.path.join(SESSIONS_DATA_DIR, state.session_id, "gallery")
        os.makedirs(gallery_dir, exist_ok=True)
        gallery_frames = []  # List of saved gallery frame paths

        # Process frames
        frames = []
        all_frame_results = []
        filenames = sorted(os.listdir(state.frames_dir))
        total_files = len([f for f in filenames if f.endswith(".jpg")])

        for i, fname in enumerate(filenames):
            if not fname.endswith(".jpg"):
                continue

            filepath = os.path.join(state.frames_dir, fname)
            with open(filepath, "rb") as f:
                image_bytes = f.read()

            frame_idx = int(fname.split("_")[1].split(".")[0])

            # Detect small ball
            res = distance_mask_detect_small_ball(image_bytes, target_bgr=state.small_ball_bgr)

            # Detect big ball
            if state.big_ball_bgr:
                bb_res = distance_mask_detect_big_ball(image_bytes, target_bgr=state.big_ball_bgr)
            else:
                bb_res = hough_detect_big_ball(image_bytes)

            all_frame_results.append({
                "frame_index": frame_idx,
                "detected": res.get("detected", False),
                "score": round(float(res.get("score", 0)), 3),
                "big_detected": bb_res.get("detected", False)
            })

            if res.get("detected"):
                frames.append({
                    "frame_index": int(frame_idx),
                    "score": float(res.get("score", 0.5)),
                    "x_px": float(res["x_px"]),
                    "y_px": float(res["y_px"]),
                    "radius_px": float(res.get("radius_px", 10)),
                    "filepath": filepath
                })

            # Generate annotated debug frame and save to gallery
            try:
                np_arr = np.frombuffer(image_bytes, np.uint8)
                debug_img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
                if debug_img is not None:
                    # Draw small ball detection
                    if res.get("detected"):
                        x, y = int(res["x_px"]), int(res["y_px"])
                        r = int(res.get("radius_px", 15))
                        cv2.circle(debug_img, (x, y), r, (0, 255, 0), 3)  # Green circle
                        cv2.circle(debug_img, (x, y), 5, (0, 255, 0), -1)  # Green dot
                        cv2.putText(debug_img, f"Small: {res.get('score', 0):.2f}", (x - 40, y - r - 10),
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

                    # Draw big ball detection
                    if bb_res.get("detected"):
                        bx, by = int(bb_res["x_px"]), int(bb_res["y_px"])
                        br = int(bb_res.get("radius_px", 30))
                        # Ensure minimum visible radius of 25px for drawing
                        draw_radius = max(br, 25)
                        cv2.circle(debug_img, (bx, by), draw_radius, (255, 0, 255), 4)  # Magenta circle (thicker)
                        cv2.circle(debug_img, (bx, by), 8, (255, 0, 255), -1)  # Magenta dot (larger)
                        # Show actual detected radius in annotation
                        area = bb_res.get("area", 0)
                        cv2.putText(debug_img, f"Big: r={br}px a={area}", (bx - 60, by - draw_radius - 10),
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 0, 255), 2)

                    # Add frame info
                    cv2.putText(debug_img, f"Frame {frame_idx}/{total_files}", (10, 30),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
                    status_text = "DETECTED" if res.get("detected") else "NO DETECTION"
                    status_color = (0, 255, 0) if res.get("detected") else (0, 0, 255)
                    cv2.putText(debug_img, status_text, (10, 60),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.7, status_color, 2)

                    # Save annotated frame to gallery directory
                    gallery_frame_path = os.path.join(gallery_dir, f"annotated_{frame_idx:04d}.jpg")
                    cv2.imwrite(gallery_frame_path, debug_img, [cv2.IMWRITE_JPEG_QUALITY, 75])
                    gallery_frames.append({
                        "frame_index": frame_idx,
                        "detected": res.get("detected", False),
                        "path": gallery_frame_path
                    })

                    # Encode to base64 for live preview
                    _, buffer = cv2.imencode('.jpg', debug_img, [cv2.IMWRITE_JPEG_QUALITY, 70])
                    state.debug_frame_base64 = base64.b64encode(buffer).decode('utf-8')
                    state.current_frame_index = frame_idx
            except Exception as e:
                logger.error(f"Debug frame generation failed: {e}")

            state.progress = 0.1 + (0.3 * (i / total_files))

        state.all_frame_results = all_frame_results
        state.progress = 0.4
        state.progress_label = "Selecting best frames..."

        # Select best frames
        frames.sort(key=lambda x: x["score"], reverse=True)
        valid_frames = [f for f in frames if f["score"] > MIN_DETECTION_SCORE]
        selected_frames = valid_frames[:TARGET_FRAMES]

        if len(selected_frames) < MIN_VALID_FRAMES:
            raise ValueError(f"Only {len(selected_frames)} frames passed detection threshold")

        state.progress = 0.5
        state.progress_label = "Detecting origin..."

        # Get frame dimensions
        np_arr = np.fromfile(selected_frames[0]["filepath"], dtype=np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        frame_height, frame_width = img.shape[:2]

        # Detect big ball for origin
        best_bb = None
        for f in selected_frames[:5]:
            with open(f["filepath"], "rb") as bf:
                bb_bytes = bf.read()
            if state.big_ball_bgr:
                bb_res = distance_mask_detect_big_ball(bb_bytes, target_bgr=state.big_ball_bgr)
            else:
                bb_res = hough_detect_big_ball(bb_bytes)
            if bb_res.get("detected"):
                best_bb = bb_res
                break

        origin_x = best_bb["x_px"] if best_bb else frame_width / 2.0
        origin_y = best_bb["y_px"] if best_bb else frame_height / 2.0

        state.progress = 0.6
        state.progress_label = "Extracting coordinates..."

        # Transform pixel coordinates to cm coordinates
        # Use simple axis-aligned conversion (assumes camera is roughly level)
        # x_cm: positive = right, y_cm: positive = up (flipped from image coords)
        coordinates = []
        for f in selected_frames:
            rel_px_x = f["x_px"] - origin_x
            rel_px_y = f["y_px"] - origin_y
            # Simple scaling without rotation - matches visualization code
            x_cm = rel_px_x / state.px_per_cm
            y_cm = -rel_px_y / state.px_per_cm  # Negative because image Y increases downward

            coordinates.append({
                "x_cm": round(float(x_cm), 3),
                "y_cm": round(float(y_cm), 3),
                "frame_index": int(f["frame_index"]),
                "score": round(float(f["score"]), 3)
            })

        state.progress = 0.7
        state.progress_label = "Fitting curves..."

        # Curve fitting
        fit_result = fit_curves(coordinates)
        logger.info(f"Winning curve: {fit_result['winning_curve']}")

        # Save results
        run_id = f"run_{state.session_code}_{int(time.time())}"
        run_dir = os.path.join(RUNS_DATA_DIR, run_id)
        os.makedirs(run_dir, exist_ok=True)

        state.progress = 0.85
        state.progress_label = "Generating visualization..."

        # Generate visualization
        try:
            middle_f = selected_frames[len(selected_frames)//2]
            img_bg = cv2.imread(middle_f["filepath"])
            if img_bg is not None:
                draw_physics_overlay(img_bg, fit_result, origin_x, origin_y, state.px_per_cm, coordinates)
                viz_path = os.path.join(run_dir, "visualization.jpg")
                cv2.imwrite(viz_path, img_bg)
        except Exception as e:
            logger.error(f"Visualization failed: {e}")

        # Copy gallery frames to run directory
        state.progress_label = "Saving gallery frames..."
        gallery_urls = []
        run_gallery_dir = os.path.join(run_dir, "gallery")
        try:
            if os.path.exists(gallery_dir) and gallery_frames:
                shutil.copytree(gallery_dir, run_gallery_dir)
                # Build gallery URLs sorted by frame index
                for gf in sorted(gallery_frames, key=lambda x: x["frame_index"]):
                    filename = f"annotated_{gf['frame_index']:04d}.jpg"
                    gallery_urls.append({
                        "frame_index": gf["frame_index"],
                        "detected": gf["detected"],
                        "url": f"/data/runs/{run_id}/gallery/{filename}"
                    })
                logger.info(f"Saved {len(gallery_urls)} gallery frames")
        except Exception as e:
            logger.error(f"Gallery save failed: {e}")

        # Cleanup frames and temp gallery
        try:
            shutil.rmtree(state.frames_dir)
            shutil.rmtree(gallery_dir)
        except:
            pass

        state.progress = 1.0
        state.progress_label = "Done"

        # Build run data
        detected_count = len([f for f in all_frame_results if f["detected"]])
        run_data = {
            "run_id": run_id,
            "session_code": state.session_code,
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "coordinates": coordinates,
            "big_ball_center": {"x_cm": 0.0, "y_cm": 0.0},
            "visualization_url": f"/data/runs/{run_id}/visualization.jpg",
            "gallery": gallery_urls,  # All annotated frames
            "stats": {
                "total_frames": len(all_frame_results),
                "detected_frames": detected_count,
                "selected_frames": len(selected_frames),
                "px_per_cm": round(float(state.px_per_cm), 2)
            },
            **fit_result
        }

        append_run(run_data)
        state.result = run_data
        state.status = "done"
        logger.info(f"Pipeline complete: {run_id}")

    except Exception as e:
        state.status = "error"
        state.error_message = str(e)
        logger.error(f"Pipeline failed: {str(e)}")


@app.post("/stop")
async def stop(background_tasks: BackgroundTasks, x_session_code: str = Header(None)):
    """Stop recording and trigger processing."""
    try:
        if not x_session_code:
            raise ValueError("X-Session-Code header required")
        state = get_session_by_code(x_session_code)
        if not state:
            raise ValueError("Session not found")

        state.status = "processing"
        background_tasks.add_task(run_pipeline, x_session_code)
        return {"ok": True, "message": "Processing started"}
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})


@app.get("/status")
def get_status(x_session_code: str = Header(None)):
    """Get session status."""
    try:
        if not x_session_code:
            return {"status": "idle"}

        state = get_session_by_code(x_session_code)
        if not state:
            return {"status": "idle", "message": "Session not found"}

        if state.status == "processing":
            return {
                "status": "processing",
                "progress": state.progress,
                "progress_label": state.progress_label,
                "debug_frame": state.debug_frame_base64,
                "current_frame": state.current_frame_index
            }
        elif state.status == "done":
            return {
                "status": "done",
                "run_id": state.result.get("run_id") if state.result else None
            }
        elif state.status == "error":
            return {"status": "error", "error": state.error_message}
        elif state.status == "recording":
            return {"status": "recording", "frame_count": state.frame_count}
        else:
            return {
                "status": "idle",
                "calibrated": state.is_calibrated(),
                "setup_complete": state.is_setup_complete()
            }
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})


@app.get("/runs")
def list_runs():
    """List all past runs."""
    try:
        return {"runs": get_all_runs()}
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})


@app.get("/runs/{run_id}")
def get_run(run_id: str):
    """Get a specific run by ID."""
    try:
        run = get_run_by_id(run_id)
        if not run:
            raise ValueError("Run not found")
        return run
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})


@app.post("/process")
async def process_frames(request: Request, x_session_code: str = Header(None)):
    """
    Process an array of base64-encoded frames directly.
    This is the simplified endpoint for the unified app.

    Body: {
        "frames": ["<base64 JPEG>", "<base64 JPEG>", ...]
    }

    Returns: Full run result with coordinates, curve fitting, and stats.
    """
    try:
        if not x_session_code:
            raise ValueError("X-Session-Code header required")
        state = get_session_by_code(x_session_code)
        if not state:
            raise ValueError("Session not found")

        if not state.px_per_cm:
            raise ValueError("Calibration not completed")
        if not state.small_ball_bgr:
            raise ValueError("Small ball color not set")

        data = await request.json()
        frames_base64 = data.get("frames", [])

        if len(frames_base64) < MIN_VALID_FRAMES:
            raise ValueError(f"Need at least {MIN_VALID_FRAMES} frames, got {len(frames_base64)}")

        logger.info(f"Processing {len(frames_base64)} frames for session {x_session_code}")

        # Process frames
        frames = []
        all_frame_results = []

        for i, frame_b64 in enumerate(frames_base64):
            image_bytes = base64.b64decode(frame_b64)

            # Detect small ball
            res = distance_mask_detect_small_ball(image_bytes, target_bgr=state.small_ball_bgr)

            # Detect big ball
            if state.big_ball_bgr:
                bb_res = distance_mask_detect_big_ball(image_bytes, target_bgr=state.big_ball_bgr)
            else:
                bb_res = hough_detect_big_ball(image_bytes)

            all_frame_results.append({
                "frame_index": i,
                "detected": res.get("detected", False),
                "score": round(float(res.get("score", 0)), 3),
                "big_detected": bb_res.get("detected", False)
            })

            if res.get("detected"):
                frames.append({
                    "frame_index": int(i),
                    "score": float(res.get("score", 0.5)),
                    "x_px": float(res["x_px"]),
                    "y_px": float(res["y_px"]),
                    "radius_px": float(res.get("radius_px", 10)),
                    "image_bytes": image_bytes
                })

        # Select best frames
        frames.sort(key=lambda x: x["score"], reverse=True)
        valid_frames = [f for f in frames if f["score"] > MIN_DETECTION_SCORE]
        selected_frames = valid_frames[:TARGET_FRAMES]

        if len(selected_frames) < MIN_VALID_FRAMES:
            raise ValueError(f"Only {len(selected_frames)} frames passed detection threshold")

        # Get frame dimensions from first frame
        np_arr = np.frombuffer(selected_frames[0]["image_bytes"], np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        frame_height, frame_width = img.shape[:2]

        # Detect big ball for origin
        best_bb = None
        for f in selected_frames[:5]:
            if state.big_ball_bgr:
                bb_res = distance_mask_detect_big_ball(f["image_bytes"], target_bgr=state.big_ball_bgr)
            else:
                bb_res = hough_detect_big_ball(f["image_bytes"])
            if bb_res.get("detected"):
                best_bb = bb_res
                break

        origin_x = best_bb["x_px"] if best_bb else frame_width / 2.0
        origin_y = best_bb["y_px"] if best_bb else frame_height / 2.0

        # Transform pixel coordinates to cm coordinates
        # Use simple axis-aligned conversion (assumes camera is roughly level)
        # x_cm: positive = right, y_cm: positive = up (flipped from image coords)
        coordinates = []
        for f in selected_frames:
            rel_px_x = f["x_px"] - origin_x
            rel_px_y = f["y_px"] - origin_y
            # Simple scaling without rotation - matches visualization code
            x_cm = rel_px_x / state.px_per_cm
            y_cm = -rel_px_y / state.px_per_cm  # Negative because image Y increases downward

            coordinates.append({
                "x_cm": round(float(x_cm), 3),
                "y_cm": round(float(y_cm), 3),
                "frame_index": int(f["frame_index"]),
                "score": round(float(f["score"]), 3)
            })

        # Curve fitting
        fit_result = fit_curves(coordinates)
        logger.info(f"Winning curve: {fit_result['winning_curve']}")

        # Save results
        run_id = f"run_{state.session_code}_{int(time.time())}"
        run_dir = os.path.join(RUNS_DATA_DIR, run_id)
        os.makedirs(run_dir, exist_ok=True)

        # Generate visualization
        try:
            middle_f = selected_frames[len(selected_frames)//2]
            np_arr = np.frombuffer(middle_f["image_bytes"], np.uint8)
            img_bg = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            if img_bg is not None:
                draw_physics_overlay(img_bg, fit_result, origin_x, origin_y, state.px_per_cm, coordinates)
                viz_path = os.path.join(run_dir, "visualization.jpg")
                cv2.imwrite(viz_path, img_bg)
        except Exception as e:
            logger.error(f"Visualization failed: {e}")

        # Build run data
        detected_count = len([f for f in all_frame_results if f["detected"]])
        run_data = {
            "run_id": run_id,
            "session_code": state.session_code,
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "coordinates": coordinates,
            "big_ball_center": {"x_cm": 0.0, "y_cm": 0.0},
            "visualization_url": f"/data/runs/{run_id}/visualization.jpg",
            "stats": {
                "total_frames": len(all_frame_results),
                "detected_frames": detected_count,
                "selected_frames": len(selected_frames),
                "px_per_cm": round(float(state.px_per_cm), 2)
            },
            **fit_result
        }

        append_run(run_data)
        logger.info(f"Processing complete: {run_id}")

        return {"ok": True, **run_data}

    except Exception as e:
        logger.error(f"Process frames failed: {str(e)}")
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
