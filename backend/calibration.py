"""
Calibration Module

This module handles the detection of the circular calibration marker
and the calculation of the pixels-per-centimeter ratio.
"""

import cv2
import numpy as np

# Physical diameter of the printed black circle calibration marker
MARKER_DIAMETER_CM = 9.0

def process_calibration_frame(image_bytes: bytes) -> tuple[float, float]:
    """
    Detect the calibration marker in a frame and compute scale.

    Args:
        image_bytes: Raw JPEG bytes of the calibration frame.

    Returns:
        tuple: (px_per_cm, marker_radius_px)

    Raises:
        ValueError: If no valid marker is detected.
    """
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
