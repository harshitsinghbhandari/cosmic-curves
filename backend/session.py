"""
Session Module

This module defines the session state and logic for experiment sessions.
Each session tracks the progress, calibration, and recording status of a run.
"""

from dataclasses import dataclass
from typing import Dict, Any, Optional

@dataclass
class SessionState:
    """
    State of an active experiment session.

    Attributes:
        session_id: Unique UUID string for internal identification.
        session_code: Human-readable 6-character session code.
        frames_dir: File path to temporary frame storage for this session.
        frame_count: Number of frames successfully received.
        hsv_ranges: Computed HSV mask ranges for color detection.
        px_per_cm: Pixels-per-centimeter ratio computed from calibration marker.
        status: Current status (idle, recording, processing, done, or error).
        progress: Pipeline processing progress (0.0 to 1.0).
        progress_label: Text description of the current processing step.
        result: Final run data object after processing is complete.
        error_message: Optional error details if the pipeline fails.
        latest_preview_frame: The most recent JPEG frame for setup previews.
    """
    session_id: str
    session_code: str
    frames_dir: str
    frame_count: int = 0
    hsv_ranges: Optional[Dict[str, Any]] = None
    px_per_cm: Optional[float] = None
    status: str = "idle" 
    progress: float = 0.0
    progress_label: str = ""
    result: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    latest_preview_frame: Optional[bytes] = None

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
