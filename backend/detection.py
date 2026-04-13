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

    # Check size consistency (warn but don't fail)
    size_ratio = min(marker1["area"], marker2["area"]) / max(marker1["area"], marker2["area"])
    size_warning = None
    if size_ratio < (1 - MARKER_SIZE_TOLERANCE):
        size_warning = f"Markers have inconsistent sizes (ratio: {size_ratio:.2f})"
        print(f"[DEBUG detect_color_markers] WARNING: {size_warning}")

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
        "px_distance": px_distance,
        "size_ratio": round(size_ratio, 2),
        "size_warning": size_warning
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

def _compute_blob_score(contour, mask, dist_map) -> float:
    """
    Compute a quality score for a detected blob based on:
    1. Circularity (how round is the shape) - 40% weight
    2. Color match (average color distance of pixels) - 40% weight
    3. Solidity (filled vs holey) - 20% weight

    Returns a score from 0.0 to 1.0
    """
    area = cv2.contourArea(contour)
    if area < 1:
        return 0.0

    # 1. Circularity: 4π × area / perimeter²  (1.0 = perfect circle)
    perimeter = cv2.arcLength(contour, True)
    if perimeter > 0:
        circularity = (4 * np.pi * area) / (perimeter * perimeter)
        circularity = min(1.0, circularity)  # Cap at 1.0
    else:
        circularity = 0.0

    # 2. Color match: average distance of detected pixels (lower = better)
    # Create a mask for just this contour
    contour_mask = np.zeros(mask.shape, dtype=np.uint8)
    cv2.drawContours(contour_mask, [contour], -1, 255, -1)

    # Get average color distance within the contour
    pixels_in_contour = dist_map[contour_mask > 0]
    if len(pixels_in_contour) > 0:
        avg_distance = np.mean(pixels_in_contour)
        # Normalize: 0 distance = 1.0 score, 30+ distance = 0.0 score
        color_score = max(0.0, 1.0 - (avg_distance / 30.0))
    else:
        color_score = 0.0

    # 3. Solidity: contour area / convex hull area (1.0 = no holes/concavities)
    hull = cv2.convexHull(contour)
    hull_area = cv2.contourArea(hull)
    if hull_area > 0:
        solidity = area / hull_area
    else:
        solidity = 0.0

    # Weighted combination
    score = (0.4 * circularity) + (0.4 * color_score) + (0.2 * solidity)
    return round(score, 3)


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
        dict with detection result including x_px, y_px, radius_px, score, area
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
    best_score = 0

    for cnt in contours:
        area = cv2.contourArea(cnt)
        # Small ball area range: 2-2000 pixels
        if 2 < area < 2000:
            score = _compute_blob_score(cnt, mask, dist)
            if score > best_score:
                best_score = score
                (x, y), radius = cv2.minEnclosingCircle(cnt)
                best_candidate = {
                    "detected": True,
                    "x_px": int(x),
                    "y_px": int(y),
                    "radius_px": int(radius),
                    "area": int(area),
                    "score": score
                }

    return best_candidate if best_candidate else {"detected": False}


def distance_mask_detect_big_ball(
    image_input,
    target_bgr: List[int],
    threshold: int = 40
) -> Dict[str, Any]:
    """
    Detect the BIG ball using Euclidean Distance Masking.
    Same logic as small ball but with larger area thresholds.

    Args:
        image_input: Raw JPEG bytes or numpy array
        target_bgr: BGR color values [B, G, R] to detect (required)
        threshold: Color distance threshold (default 40, higher for big ball to catch more pixels)

    Returns:
        dict with detection result including x_px, y_px, radius_px, score, area
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
    # Use larger kernel and more aggressive closing for big ball
    kernel = np.ones((9, 9), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_DILATE, kernel, iterations=1)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    best_candidate = None
    best_score = 0

    for cnt in contours:
        area = cv2.contourArea(cnt)
        # Big ball area range: 1000-150000 pixels (increased range)
        if 1000 < area < 150000:
            score = _compute_blob_score(cnt, mask, dist)
            if score > best_score:
                best_score = score
                (x, y), enclosing_radius = cv2.minEnclosingCircle(cnt)
                # Calculate radius from area for a more accurate visual size
                # area = π * r², so r = sqrt(area / π)
                area_based_radius = np.sqrt(area / np.pi)
                # Use the larger of the two radius estimates
                radius = max(enclosing_radius, area_based_radius)
                best_candidate = {
                    "detected": True,
                    "x_px": int(x),
                    "y_px": int(y),
                    "radius_px": int(radius),
                    "area": int(area),
                    "score": score
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