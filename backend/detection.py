"""
Ball Detection Module

This module provides functions for detecting balls in video frames using
HSV color space masking and contour analysis.

The detection pipeline:
1. Convert frame to HSV color space
2. Apply color range mask
3. Find contours
4. Filter by area and circularity
5. Score candidates and return best match

Constants:
    MIN_CONTOUR_AREA_PX: Minimum contour area in pixels (filters noise)
    MIN_CIRCULARITY: Minimum circularity threshold (0-1, filters non-circular shapes)
    MIN_DETECTION_SCORE: Minimum score for valid detection
    TARGET_FRAMES: Number of frames to select for analysis
    MIN_VALID_FRAMES: Minimum frames required for valid run

Author: CosmosCurves Team
License: MIT
"""

import cv2
import numpy as np

# Detection thresholds
MIN_CONTOUR_AREA_PX = 100      # Minimum contour area to consider (pixels)
MIN_CIRCULARITY = 0.70         # Minimum circularity (0-1, higher = more circular)
MIN_DETECTION_SCORE = 0.40     # Minimum score to accept a frame
TARGET_FRAMES = 25             # Number of frames to analyze
MIN_VALID_FRAMES = 10          # Minimum frames needed for valid run


def compute_hsv_ranges(rgb_dict: dict) -> dict:
    """
    Convert HSV color sample to detection range with tolerance.

    Takes a sampled color in HSV format and computes a range for masking
    that accounts for lighting variations and color differences.

    Args:
        rgb_dict: Dictionary with 'h', 's', 'v' keys (0-360, 0-255, 0-255)
                  Note: H may need conversion if in standard 0-360 range
                  OpenCV uses H in 0-179 range

    Returns:
        dict: Dictionary with 'h', 's', 'v' keys, each containing [min, max] pairs

    Example:
        >>> compute_hsv_ranges({'h': 45, 's': 180, 'v': 220})
        {'h': [30, 60], 's': [140, 220], 'v': [180, 255]}
    """
    h = rgb_dict.get("h", 0)
    s = rgb_dict.get("s", 0)
    v = rgb_dict.get("v", 0)

    # Convert H from 0-360 to OpenCV's 0-179 if needed
    if h > 179:
        h = int(h / 2)

    return {
        "h": [max(0, h - 15), min(179, h + 15)],
        "s": [max(0, s - 40), min(255, s + 40)],
        "v": [max(0, v - 40), min(255, v + 40)]
    }


def detect_ball_in_frame(image_bytes: bytes, hsv_range: dict) -> dict:
    """
    Detect a ball in a JPEG frame using HSV color masking.

    Processes a JPEG image to find circular objects matching the specified
    color range. Returns the best candidate based on circularity score.

    Args:
        image_bytes: Raw JPEG image bytes
        hsv_range: Dictionary with 'h', 's', 'v' keys, each containing [min, max]
                   Example: {'h': [30, 60], 's': [140, 220], 'v': [180, 255]}

    Returns:
        dict: Detection result with keys:
            - detected (bool): True if ball found
            - x_px (int): X coordinate of ball center (if detected)
            - y_px (int): Y coordinate of ball center (if detected)
            - radius_px (int): Radius of enclosing circle (if detected)
            - score (float): Detection confidence score 0-1 (if detected)

    Example:
        >>> result = detect_ball_in_frame(jpeg_bytes, hsv_range)
        >>> if result['detected']:
        ...     print(f"Ball at ({result['x_px']}, {result['y_px']})")
    """
    # Decode JPEG to numpy array
    np_arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    if img is None:
        return {"detected": False}

    # Convert to HSV color space
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

    # Create color mask from HSV range
    lower = np.array([hsv_range["h"][0], hsv_range["s"][0], hsv_range["v"][0]])
    upper = np.array([hsv_range["h"][1], hsv_range["s"][1], hsv_range["v"][1]])

    mask = cv2.inRange(hsv, lower, upper)
    mask = cv2.medianBlur(mask, 5)  # Remove noise

    # Find contours in the mask
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    best_score = 0
    best_candidate = None

    for cnt in contours:
        area = cv2.contourArea(cnt)

        # Filter by minimum area
        if area > MIN_CONTOUR_AREA_PX:
            perimeter = cv2.arcLength(cnt, True)

            if perimeter > 0:
                # Calculate circularity: 4π×area/perimeter²
                # Perfect circle = 1.0
                circularity = 4 * np.pi * area / (perimeter * perimeter)

                if circularity > MIN_CIRCULARITY:
                    # Score based on circularity
                    score = circularity

                    if score > best_score:
                        # Calculate centroid using moments
                        M = cv2.moments(cnt)
                        if M["m00"] > 0:
                            cx = int(M["m10"] / M["m00"])
                            cy = int(M["m01"] / M["m00"])

                            # Get minimum enclosing circle radius
                            (_, _), radius = cv2.minEnclosingCircle(cnt)

                            best_score = score
                            best_candidate = {
                                "x_px": cx,
                                "y_px": cy,
                                "radius_px": int(radius),
                                "score": best_score
                            }

    if best_candidate:
        best_candidate["detected"] = True
        return best_candidate

    return {"detected": False}