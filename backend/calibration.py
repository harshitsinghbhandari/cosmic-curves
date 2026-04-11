"""
Calibration Module

This module handles marker-based calibration using two same-color markers
to define the coordinate system axes and calculate the pixels-per-centimeter ratio.
"""

import cv2
import numpy as np
from typing import Dict, Any, List, Tuple
from detection import detect_color_markers


def process_calibration_with_markers(
    image_bytes: bytes,
    marker_bgr: List[int],
    marker_distance_cm: float
) -> Dict[str, Any]:
    """
    Process calibration using two color markers.

    Args:
        image_bytes: Raw JPEG bytes of the calibration frame
        marker_bgr: BGR color values [B, G, R] for the markers
        marker_distance_cm: Physical distance between markers in centimeters

    Returns:
        dict with:
            - px_per_cm: Pixels per centimeter ratio
            - marker1: {x_px, y_px} of first marker
            - marker2: {x_px, y_px} of second marker
            - y_axis: [dx, dy] normalized vector pointing up
            - x_axis: [dx, dy] normalized vector perpendicular to y

    Raises:
        ValueError: If markers cannot be detected or are invalid
    """
    if marker_distance_cm <= 0:
        raise ValueError("Marker distance must be positive")

    # Detect the color markers
    result = detect_color_markers(image_bytes, marker_bgr)

    if not result.get("detected"):
        error_msg = result.get("error", "Failed to detect markers")
        raise ValueError(error_msg)

    px_distance = result["px_distance"]
    px_per_cm = px_distance / marker_distance_cm

    return {
        "px_per_cm": px_per_cm,
        "marker1": {
            "x_px": result["marker1"]["x_px"],
            "y_px": result["marker1"]["y_px"]
        },
        "marker2": {
            "x_px": result["marker2"]["x_px"],
            "y_px": result["marker2"]["y_px"]
        },
        "y_axis": result["y_axis_vector"],
        "x_axis": result["x_axis_vector"],
        "px_distance": px_distance
    }


# Legacy function kept for backward compatibility
def process_calibration_frame(image_bytes: bytes) -> Tuple[float, float]:
    """
    Legacy function - detects calibration marker using black circle.
    Kept for backward compatibility but marker-based calibration is preferred.

    Args:
        image_bytes: Raw JPEG bytes of the calibration frame.

    Returns:
        tuple: (px_per_cm, marker_radius_px)

    Raises:
        ValueError: If no valid marker is detected.
    """
    # Physical diameter of the printed black circle calibration marker
    MARKER_DIAMETER_CM = 9.0

    np_arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError("Failed to decode image")

    # Pre-processing for edge detection
    blurred = cv2.GaussianBlur(img, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)

    # Find all external contours
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    best_radius = 0
    best_px_per_cm = 0

    for cnt in contours:
        area = cv2.contourArea(cnt)
        # Filter for reasonably sized contours to reduce noise
        if area > 5000:
            perimeter = cv2.arcLength(cnt, True)
            if perimeter > 0:
                # Calculate circularity
                circularity = 4 * np.pi * area / (perimeter * perimeter)
                if circularity > 0.85:
                    # Found a circular candidate
                    (_, _), radius = cv2.minEnclosingCircle(cnt)
                    px_per_cm = (radius * 2) / MARKER_DIAMETER_CM
                    # Keep the largest valid marker
                    if area > best_radius * best_radius * np.pi:
                        best_radius = radius
                        best_px_per_cm = px_per_cm

    if best_radius > 0:
        return best_px_per_cm, best_radius

    raise ValueError("No circular marker detected — ensure sheet is fully visible and well-lit")
