import json
import cv2
import sys
import os
import numpy as np

# Add backend to path so we can access the physics engine
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from backend.curve_fitting import fit_curves

def draw_physics_overlay(image, result, origin_x, origin_y, px_per_cm, points_cm):
    """Draw the mathematical curve and detected points on the image"""
    h, w = image.shape[:2]
    color_curve = (255, 0, 255) # Magenta for the math
    color_pts = (0, 255, 0)     # Green for detections
    
    # 1. Draw the detected points (cm back to pixels)
    for p in points_cm:
        px = int(p['x_cm'] * px_per_cm + origin_x)
        py = int(origin_y - p['y_cm'] * px_per_cm)
        cv2.circle(image, (px, py), 4, color_pts, -1)

    # 2. Draw the fitted curve
    winner = result['winning_curve']
    eq = result['equation']['coefficients']
    
    # Scan X across the entire image width
    x_range_cm = np.linspace(-origin_x / px_per_cm, (w - origin_x) / px_per_cm, 2000)
    
    if winner == 'parabola':
        a, b, c = eq['a'], eq['b'], eq['c']
        for x in x_range_cm:
            y = a * x**2 + b * x + c
            px = int(x * px_per_cm + origin_x)
            py = int(origin_y - y * px_per_cm)
            if 0 <= px < w and 0 <= py < h:
                cv2.circle(image, (px, py), 1, color_curve, -1)
    
    else: # Conic (Ellipse/Hyperbola)
        # Solve implicit: Cy² + (Bx + E)y + (Ax² + Dx + F) = 0
        A, B, C, D, E, F = eq['A'], eq['B'], eq['C'], eq['D'], eq['E'], eq['F']
        for x in x_range_cm:
            qa = C
            qb = B * x + E
            qc = A * x**2 + D * x + F
            
            det = qb**2 - 4 * qa * qc
            if det >= 0:
                sqrt_det = np.sqrt(det)
                for sign in [1, -1]:
                    y = (-qb + sign * sqrt_det) / (2 * qa)
                    px = int(x * px_per_cm + origin_x)
                    py = int(origin_y - y * px_per_cm)
                    if 0 <= px < w and 0 <= py < h:
                        cv2.circle(image, (px, py), 1, color_curve, -1)

    # Add legend
    cv2.putText(image, f"Model: {winner.upper()}", (50, 80), 
                cv2.FONT_HERSHEY_SIMPLEX, 1.2, color_curve, 3)
    cv2.putText(image, result['equation']['display'], (50, 130), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, color_curve, 2)

def run_curve_test():
    log_path = "tests/detections.json"
    if not os.path.exists(log_path):
        print(f"Error: {log_path} not found. Run tests/test_detection.py first.")
        return

    with open(log_path, 'r') as f:
        data = json.load(f)

    # Get video dimensions
    video_path = data["video"]
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        frame_width, frame_height = 1080, 1920
    else:
        frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        cap.release()

    origin_x = frame_width / 2.0
    origin_y = frame_height / 2.0
    px_per_cm = 20.0 

    coordinates = []
    frames_present = []
    for d in data["detections"]:
        if d["small"]:
            x_cm = (d["small"]["x_px"] - origin_x) / px_per_cm
            y_cm = (origin_y - d["small"]["y_px"]) / px_per_cm
            coordinates.append({"x_cm": round(x_cm, 3), "y_cm": round(y_cm, 3)})
            frames_present.append(d["frame_index"])

    if len(coordinates) < 10:
        print("Error: Not enough points.")
        return

    print(f"Fitting curves to {len(coordinates)} points...")
    result = fit_curves(coordinates)

    # Identify the "middle" frame for overlay
    middle_idx = len(frames_present) // 2
    target_frame = frames_present[middle_idx]
    frame_path = f"tests/output_frames/frame_{target_frame:04d}.jpg"

    if os.path.exists(frame_path):
        print(f"Generating overlay on middle frame: {frame_path}")
        img = cv2.imread(frame_path)
        draw_physics_overlay(img, result, origin_x, origin_y, px_per_cm, coordinates)
        
        overlay_path = "tests/curve_overlay.jpg"
        cv2.imwrite(overlay_path, img)
        print(f"Overlay saved to {overlay_path}")
    else:
        print(f"Warning: Could not find frame {frame_path} for overlay.")

    print("\n" + "═"*50)
    print(f" Winning Model:   {result['winning_curve'].upper()}")
    print(f" Equation:        {result['equation']['display']}")
    print("═"*50)

if __name__ == "__main__":
    run_curve_test()
