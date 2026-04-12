"""
Ball Detection Module - Refined Hybrid Pipeline

This module provides specialized functions for detecting balls in video frames.
It uses a hybrid approach:
1. Big Ball: Hough Circle Transform (Shape-based)
2. Small Ball: Euclidean Distance Masking (Color proximity-based)
3. Color Markers: Euclidean Distance Masking for calibration markers

Author: CosmosCurves Team
License: MIT
"""

import cv2
import numpy as np
from typing import List, Dict, Any, Optional, Tuple

# Detection thresholds (kept for tuning if needed)
MIN_DETECTION_SCORE = 0.10  # Lowered from 0.40 - small balls have small areas
TARGET_FRAMES = 25
MIN_VALID_FRAMES = 10

# Marker detection thresholds
MARKER_MIN_AREA = 100  # Lowered to catch smaller markers
MARKER_MAX_AREA = 80000  # Increased for larger markers
MARKER_SIZE_TOLERANCE = 0.5  # Allow 50% size difference between markers          

def _get_image(image_input):
    """Internal helper to decode bytes or return the image array"""
    if isinstance(image_input, bytes):
        np_arr = np.frombuffer(image_input, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        return img
    return image_input

def compute_hsv_ranges(rgb_dict: dict) -> dict:
    """
    (Legacy) Kept for API compatibility with setup phase.
    Converts HSV color sample to detection range with tolerance.
    """
    h = rgb_dict.get("h", 0)
    s = rgb_dict.get("s", 0)
    v = rgb_dict.get("v", 0)

    if h > 179:
        h = int(h / 2)

    return {
        "h": [max(0, h - 15), min(179, h + 15)],
        "s": [max(0, s - 40), min(255, s + 40)],
        "v": [max(0, v - 40), min(255, v + 40)]
    }


def detect_color_markers(
    image_input,
    target_bgr: List[int],
    threshold: int = 60
) -> Dict[str, Any]:
    """
    Detect two color markers for axis calibration using Euclidean distance masking.

    Args:
        image_input: Raw JPEG bytes or numpy array
        target_bgr: BGR color values [B, G, R] to detect
        threshold: Color distance threshold (default 35)

    Returns:
        dict with:
            - detected: bool
            - markers: list of {x_px, y_px, area} for each marker found
            - y_axis_vector: [dx, dy] normalized, pointing "up" (lower pixel Y = higher on screen)
            - x_axis_vector: [dx, dy] normalized, perpendicular to y_axis
            - px_distance: pixel distance between markers
            - error: optional error message
    """
    print(f"[DEBUG detect_color_markers] target_bgr={target_bgr}, threshold={threshold}")

    img = _get_image(image_input)
    if img is None:
        return {"detected": False, "error": "Failed to decode image"}

    print(f"[DEBUG detect_color_markers] Image shape: {img.shape}")

    # Debug: sample some pixels from the image
    h, w = img.shape[:2]
    center_pixel = img[h//2, w//2]
    print(f"[DEBUG detect_color_markers] Center pixel BGR: {center_pixel}")
    print(f"[DEBUG detect_color_markers] Target BGR: {target_bgr}")

    # Convert to float for precise distance calculation
    img_float = img.astype(np.float32)
    target = np.array(target_bgr, dtype=np.float32)

    # L2 Norm (Euclidean Distance) in 3D color space
    dist = np.linalg.norm(img_float - target, axis=2)

    # Debug: check distance stats
    print(f"[DEBUG detect_color_markers] Distance stats - min: {dist.min():.1f}, max: {dist.max():.1f}, mean: {dist.mean():.1f}")
    print(f"[DEBUG detect_color_markers] Pixels within threshold {threshold}: {np.sum(dist < threshold)}")

    # Binary mask of similar pixels
    mask = (dist < threshold).astype(np.uint8) * 255

    # Morphology to clean up noise (OPEN removes small noise, CLOSE fills gaps)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    # Find contours
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    print(f"[DEBUG detect_color_markers] Found {len(contours)} contours")

    # Filter and sort contours by area
    candidates = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if MARKER_MIN_AREA < area < MARKER_MAX_AREA:
            M = cv2.moments(cnt)
            if M["m00"] > 0:
                cx = int(M["m10"] / M["m00"])
                cy = int(M["m01"] / M["m00"])
                candidates.append({
                    "x_px": cx,
                    "y_px": cy,
                    "area": area
                })

    # Sort by area (largest first)
    candidates.sort(key=lambda x: x["area"], reverse=True)
    print(f"[DEBUG detect_color_markers] Valid candidates (area {MARKER_MIN_AREA}-{MARKER_MAX_AREA}): {len(candidates)}")
    for i, c in enumerate(candidates[:5]):
        print(f"[DEBUG]   Candidate {i}: pos=({c['x_px']}, {c['y_px']}), area={c['area']}")

    if len(candidates) < 2:
        # Fallback: if only 1 marker found, return it with partial result
        if len(candidates) == 1:
            return {
                "detected": False,
                "markers": candidates,
                "error": "Only 1 marker detected, need 2 for axis calibration"
            }
        return {"detected": False, "markers": [], "error": "No markers detected"}

    # Take the two largest markers
    marker1 = candidates[0]
    marker2 = candidates[1]

    # Validate similar size (within tolerance)
    size_ratio = min(marker1["area"], marker2["area"]) / max(marker1["area"], marker2["area"])
    if size_ratio < (1 - MARKER_SIZE_TOLERANCE):
        return {
            "detected": False,
            "markers": [marker1, marker2],
            "error": f"Markers have inconsistent sizes (ratio: {size_ratio:.2f})"
        }

    # Determine Y-axis direction: "up" means marker with lower Y pixel value
    # In image coordinates, Y increases downward, so lower Y = higher on screen
    if marker1["y_px"] < marker2["y_px"]:
        top_marker = marker1
        bottom_marker = marker2
    else:
        top_marker = marker2
        bottom_marker = marker1

    # Calculate axis vectors
    dx = top_marker["x_px"] - bottom_marker["x_px"]
    dy = top_marker["y_px"] - bottom_marker["y_px"]

    # Pixel distance between markers
    px_distance = np.sqrt(dx**2 + dy**2)

    if px_distance < 10:
        return {
            "detected": False,
            "markers": [marker1, marker2],
            "error": "Markers too close together"
        }

    # Normalize Y-axis vector (pointing up, toward lower Y values)
    y_axis = [dx / px_distance, dy / px_distance]

    # X-axis is perpendicular (90 degrees clockwise rotation)
    x_axis = [-y_axis[1], y_axis[0]]

    return {
        "detected": True,
        "markers": [marker1, marker2],
        "marker1": marker1,
        "marker2": marker2,
        "y_axis_vector": y_axis,
        "x_axis_vector": x_axis,
        "px_distance": px_distance
    }


def hough_detect_big_ball(image_input):
    """
    Detect the BIG ball using Hough Circle Transform.
    Does not rely on color, looks for circular gradients.
    """
    img = _get_image(image_input)
    if img is None:
        return {"detected": False}
    
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.medianBlur(gray, 5)
    
    # Radius range for big ball: 60 to 180 (Adjust if needed for distance)
    circles = cv2.HoughCircles(
        blurred, 
        cv2.HOUGH_GRADIENT, 
        dp=1.2, 
        minDist=100,
        param1=50, 
        param2=30, 
        minRadius=60, 
        maxRadius=180
    )
    
    if circles is not None:
        circles = np.uint16(np.around(circles))
        best = circles[0, 0]
        return {
            "detected": True,
            "x_px": int(best[0]),
            "y_px": int(best[1]),
            "radius_px": int(best[2]),
            "score": 1.0 # Hough detections are weighted highly
        }
    return {"detected": False}

def distance_mask_detect_small_ball(
    image_input,
    target_bgr: List[int],
    threshold: int = 30
) -> Dict[str, Any]:
    """
    Detect the SMALL ball using Euclidean Distance Masking.
    Finds pixels mathematically close to the target BGR color.

    Args:
        image_input: Raw JPEG bytes or numpy array
        target_bgr: BGR color values [B, G, R] to detect (required)
        threshold: Color distance threshold (default 30)

    Returns:
        dict with detection result including x_px, y_px, radius_px, score
    """
    img = _get_image(image_input)
    if img is None:
        return {"detected": False}
    
    # Convert to float for precise distance calculation
    img_float = img.astype(np.float32)
    target = np.array(target_bgr, dtype=np.float32)
    
    # L2 Norm (Euclidean Distance) in 3D color space
    dist = np.linalg.norm(img_float - target, axis=2)
    
    # Binary mask of similar pixels
    mask = (dist < threshold).astype(np.uint8) * 255
    
    # Morphology to clean up noise from shadows/texture
    kernel = np.ones((5, 5), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    best_candidate = None
    max_area = 0
    
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if 2 < area < 2000:
            if area > max_area:
                max_area = area
                (x, y), radius = cv2.minEnclosingCircle(cnt)
                best_candidate = {
                    "detected": True,
                    "x_px": int(x),
                    "y_px": int(y),
                    "radius_px": int(radius),
                    "score": min(1.0, area / 300.0) # Normalized score based on typical size
                }
                
    return best_candidate if best_candidate else {"detected": False}

def detect_ball_in_frame(image_bytes: bytes, hsv_range: dict) -> dict:
    """
    Legacy wrapper for existing API calls.
    Attempts to use the new specialized methods based on context clues.
    """
    # This is a fallback to keep the API alive while we transition main.py
    # Default to green target color if no specific color provided
    default_bgr = [156, 235, 167]  # #a7eb9c in BGR
    return distance_mask_detect_small_ball(image_bytes, target_bgr=default_bgr)