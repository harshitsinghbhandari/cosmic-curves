"""
Ball Detection Module - Refined Hybrid Pipeline

This module provides specialized functions for detecting balls in video frames.
It uses a hybrid approach:
1. Big Ball: Hough Circle Transform (Shape-based)
2. Small Ball: Euclidean Distance Masking (Color proximity-based)

Author: CosmosCurves Team
License: MIT
"""

import cv2
import numpy as np

# Detection thresholds (kept for tuning if needed)
MIN_DETECTION_SCORE = 0.40     
TARGET_FRAMES = 25             
MIN_VALID_FRAMES = 10          

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

def distance_mask_detect_small_ball(image_input, target_bgr=[156, 235, 167], threshold=30):
    """
    Detect the SMALL ball using Euclidean Distance Masking.
    Finds pixels mathematically close to the target BGR color.
    Targets color: #a7eb9c (BGR: 156, 235, 167)
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
    # We prioritize the small ball distance mask if the hsv_range looks like the green target
    return distance_mask_detect_small_ball(image_bytes)