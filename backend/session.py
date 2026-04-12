"""
Session Module

This module defines the session state and logic for experiment sessions.
Each session tracks the progress, calibration, and recording status of a run.
"""

import time
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List


@dataclass
class SessionState:
    """
    State of an active experiment session.

    Attributes:
        session_id: Unique UUID string for internal identification.
        session_code: Human-readable 6-character session code.
        frames_dir: File path to temporary frame storage for this session.
        frame_count: Number of frames successfully received.

        # Calibration (marker-based)
        marker_color_bgr: BGR color of the calibration markers [B, G, R]
        marker_distance_cm: Physical distance between markers in centimeters
        marker1_px: Position of first marker {x_px, y_px}
        marker2_px: Position of second marker {x_px, y_px}
        y_axis_vector: Normalized Y-axis direction [dx, dy] pointing "up"
        x_axis_vector: Normalized X-axis direction [dx, dy] perpendicular to Y
        px_per_cm: Pixels-per-centimeter ratio computed from calibration markers.

        # Detection colors
        small_ball_bgr: BGR color of the small ball to track [B, G, R]

        # Processing state
        status: Current status (idle, recording, processing, done, or error).
        progress: Pipeline processing progress (0.0 to 1.0).
        progress_label: Text description of the current processing step.
        result: Final run data object after processing is complete.
        error_message: Optional error details if the pipeline fails.
        latest_preview_frame: The most recent JPEG frame for setup previews.
        created_at: Timestamp when the session was created.
    """
    session_id: str
    session_code: str
    frames_dir: str
    frame_count: int = 0

    # Calibration (marker-based)
    marker_color_bgr: Optional[List[int]] = None
    marker_distance_cm: Optional[float] = None
    marker1_px: Optional[Dict[str, int]] = None
    marker2_px: Optional[Dict[str, int]] = None
    y_axis_vector: Optional[List[float]] = None
    x_axis_vector: Optional[List[float]] = None
    px_per_cm: Optional[float] = None

    # Detection colors
    small_ball_bgr: Optional[List[int]] = None
    big_ball_bgr: Optional[List[int]] = None

    # Processing state
    status: str = "idle"
    progress: float = 0.0
    progress_label: str = ""
    result: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    latest_preview_frame: Optional[bytes] = None
    created_at: float = field(default_factory=time.time)

    # Debug state
    debug_logs: List[str] = field(default_factory=list)
    debug_frames_dir: Optional[str] = None
    all_frame_results: List[Dict[str, Any]] = field(default_factory=list)

    def add_log(self, message: str):
        """Add a debug log entry with timestamp."""
        import datetime
        ts = datetime.datetime.now().strftime("%H:%M:%S")
        self.debug_logs.append(f"[{ts}] {message}")
        # Keep only last 200 logs
        if len(self.debug_logs) > 200:
            self.debug_logs = self.debug_logs[-200:]

    def is_calibrated(self) -> bool:
        """Check if marker calibration is complete."""
        return (
            self.px_per_cm is not None and
            self.y_axis_vector is not None and
            self.x_axis_vector is not None
        )

    def is_setup_complete(self) -> bool:
        """Check if both calibration and color setup are complete."""
        return self.is_calibrated() and self.small_ball_bgr is not None


# Global in-memory session store
sessions: Dict[str, SessionState] = {}


def get_session_by_code(code: str) -> Optional[SessionState]:
    """
    Look up an active session by its short alphanumeric code.

    Args:
        code: 6-character session code.

    Returns:
        Optional[SessionState]: The session object if found.
    """
    code_upper = code.upper()
    for state in sessions.values():
        if state.session_code == code_upper:
            return state
    return None


def clean_old_sessions(max_age_hours: int = 4):
    """
    Remove sessions older than max_age_hours from the global store.
    """
    now = time.time()
    max_age_seconds = max_age_hours * 3600
    expired_ids = [
        sid for sid, state in sessions.items()
        if now - state.created_at > max_age_seconds
    ]
    for sid in expired_ids:
        del sessions[sid]
    return len(expired_ids)
