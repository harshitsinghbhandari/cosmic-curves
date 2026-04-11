import cv2
import numpy as np
import json
import os
import sys

# Add backend to path so we can import range compute
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from backend.detection import compute_hsv_ranges

def hough_detect_big_ball(frame):
    """Detect the BIG ball using Hough Transform (Shape-based)"""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blurred = cv2.medianBlur(gray, 5)
    
    # Radius range for big ball: 60 to 180
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
            "radius_px": int(best[2])
        }
    return {"detected": False}

def distance_mask_detect_small_ball(frame, target_bgr, threshold=30, quiet=True):
    """Detect SMALL ball using Euclidean distance masking"""
    # Convert frame to float for distance calculation
    img_float = frame.astype(np.float32)
    target = np.array(target_bgr, dtype=np.float32)
    
    # Compute Euclidean distance (L2 norm) to target color
    dist = np.linalg.norm(img_float - target, axis=2)
    
    # Create mask where distance is within threshold
    mask = (dist < threshold).astype(np.uint8) * 255
    
    # Find contours
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    best_candidate = None
    max_area = 0
    
    for i, cnt in enumerate(contours):
        area = cv2.contourArea(cnt)
        if area > 0:
            (x, y), radius = cv2.minEnclosingCircle(cnt)
            
            # Filtering for typical ball sizes
            if 2 < area < 2000:
                if area > max_area:
                    max_area = area
                    best_candidate = {
                        "detected": True,
                        "x_px": int(x),
                        "y_px": int(y),
                        "radius_px": int(radius)
                    }
                    
    return best_candidate if best_candidate else {"detected": False}

def run_test():
    video_path = "IMG_0982.MOV"
    output_dir = "tests/output_frames"
    os.makedirs(output_dir, exist_ok=True)

    # Time range: 25s to 26s
    start_time = 25.0
    end_time = 26.0
    
    # Target Green Color (BGR representation of #a7eb9c)
    target_bgr = [156, 235, 167] 

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"Error: Could not open video {video_path}")
        return

    fps = cap.get(cv2.CAP_PROP_FPS)
    start_frame = int(start_time * fps)
    end_frame = int(end_time * fps)

    print(f"FPS: {fps:.2f}")
    print(f"Processing frames from {start_frame} to {end_frame} using Hybrid Pipeline...")

    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    detections_log = []
    frame_count = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        current_frame_idx = int(cap.get(cv2.CAP_PROP_POS_FRAMES)) - 1
        if current_frame_idx > end_frame:
            break

        # DETECT BIG BALL (Hough)
        big_res = hough_detect_big_ball(frame)
        
        # DETECT SMALL BALL (Distance Masking)
        small_res = distance_mask_detect_small_ball(frame, target_bgr, threshold=30, quiet=True)
        
        # Store detections for this frame
        detections_log.append({
            "frame_index": current_frame_idx,
            "small": small_res if small_res["detected"] else None,
            "big": big_res if big_res["detected"] else None
        })

        if big_res["detected"]:
            cx, cy = big_res["x_px"], big_res["y_px"]
            r = big_res["radius_px"]
            cv2.circle(frame, (cx, cy), r, (0, 0, 255), 2)
            cv2.putText(frame, f"B:({cx},{cy})", (cx + r + 5, cy),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)

        if small_res["detected"]:
            cx, cy = small_res["x_px"], small_res["y_px"]
            r = small_res["radius_px"]
            cv2.circle(frame, (cx, cy), r, (0, 255, 0), 2)
            cv2.putText(frame, f"S:({cx},{cy})", (cx + r + 5, cy),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)

        # Save annotated frame
        out_path = os.path.join(output_dir, f"frame_{current_frame_idx:04d}.jpg")
        cv2.imwrite(out_path, frame)

        frame_count += 1
        if frame_count % 10 == 0:
            print(f"Processed {frame_count} frames...")

    cap.release()
    
    # Save the detections to a JSON file
    log_path = "tests/detections.json"
    with open(log_path, 'w') as f:
        json.dump({
            "video": video_path,
            "fps": fps,
            "detections": detections_log
        }, f, indent=2)

    print(f"\nDone! Detection data stored in {log_path}")

if __name__ == "__main__":
    run_test()
