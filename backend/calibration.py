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
            - marker1: {x_px, y_px, area} of first marker
            - marker2: {x_px, y_px, area} of second marker
            - y_axis: [dx, dy] normalized vector pointing up
            - x_axis: [dx, dy] normalized vector perpendicular to y
            - size_warning: Warning message if markers have inconsistent sizes
            - annotated_image: Base64 JPEG showing detected markers

    Raises:
        ValueError: If markers cannot be detected
    """
    import base64

    if marker_distance_cm <= 0:
        raise ValueError("Marker distance must be positive")

    # Detect the color markers
    result = detect_color_markers(image_bytes, marker_bgr)

    if not result.get("detected"):
        error_msg = result.get("error", "Failed to detect markers")
        raise ValueError(error_msg)

    px_distance = result["px_distance"]
    px_per_cm = px_distance / marker_distance_cm

    # Generate annotated image showing detected markers
    np_arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    annotated_base64 = ""

    if img is not None:
        m1 = result["marker1"]
        m2 = result["marker2"]

        # Draw circles around markers
        radius1 = int(np.sqrt(m1["area"] / np.pi))
        radius2 = int(np.sqrt(m2["area"] / np.pi))

        # Marker 1 - cyan
        cv2.circle(img, (m1["x_px"], m1["y_px"]), radius1 + 10, (255, 255, 0), 3)
        cv2.putText(img, f"M1: {m1['area']}px", (m1["x_px"] - 40, m1["y_px"] - radius1 - 15),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 0), 2)

        # Marker 2 - yellow
        cv2.circle(img, (m2["x_px"], m2["y_px"]), radius2 + 10, (0, 255, 255), 3)
        cv2.putText(img, f"M2: {m2['area']}px", (m2["x_px"] - 40, m2["y_px"] - radius2 - 15),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 2)

        # Draw line between markers
        cv2.line(img, (m1["x_px"], m1["y_px"]), (m2["x_px"], m2["y_px"]), (255, 255, 255), 2)

        # Show distance and ratio info
        mid_x = (m1["x_px"] + m2["x_px"]) // 2
        mid_y = (m1["y_px"] + m2["y_px"]) // 2
        cv2.putText(img, f"{px_distance:.0f}px = {marker_distance_cm}cm",
                   (mid_x - 60, mid_y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)

        size_ratio = result.get("size_ratio", 1.0)
        ratio_color = (0, 255, 0) if size_ratio > 0.5 else (0, 0, 255)
        cv2.putText(img, f"Size ratio: {size_ratio:.2f}", (10, 30),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, ratio_color, 2)

        # Encode to base64
        _, buffer = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        annotated_base64 = base64.b64encode(buffer).decode('utf-8')

    return {
        "px_per_cm": px_per_cm,
        "marker1": {
            "x_px": result["marker1"]["x_px"],
            "y_px": result["marker1"]["y_px"],
            "area": result["marker1"]["area"]
        },
        "marker2": {
            "x_px": result["marker2"]["x_px"],
            "y_px": result["marker2"]["y_px"],
            "area": result["marker2"]["area"]
        },
        "y_axis": result["y_axis_vector"],
        "x_axis": result["x_axis_vector"],
        "px_distance": px_distance,
        "size_ratio": result.get("size_ratio", 1.0),
        "size_warning": result.get("size_warning"),
        "annotated_image": annotated_base64
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
