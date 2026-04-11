#!/usr/bin/env python3
"""
Interactive Marker Detection Test Script

Usage:
1. Place a test image in the tests/ folder
2. Run: python test_marker_detection.py <image_path>
3. Click anywhere to move the box to that position
4. Use mouse wheel to resize the box (30-50px)
5. Press 'd' to detect markers using the selected color
6. Press 'r' to reset
7. Press 'q' to quit
"""

import cv2
import numpy as np
import sys
from pathlib import Path

# Box state
box_size = 50
box_pos = [100, 100]  # [x, y] center position

# Detection results
detected_markers = []
avg_color = None

# Image dimensions for coordinate scaling
img_width = 0
img_height = 0
display_scale = 1.0


def get_box_topleft():
    return (box_pos[0] - box_size // 2, box_pos[1] - box_size // 2)


def extract_average_color(image, x, y, size):
    """Extract average BGR color from the box region."""
    h, w = image.shape[:2]

    # Clamp to image bounds
    x1 = max(0, x)
    y1 = max(0, y)
    x2 = min(w, x + size)
    y2 = min(h, y + size)

    if x2 <= x1 or y2 <= y1:
        return None

    region = image[y1:y2, x1:x2]
    avg_color = np.mean(region, axis=(0, 1)).astype(int)
    return avg_color.tolist()


def detect_markers_euclidean(image, target_bgr, threshold=35):
    """
    Detect markers using Euclidean distance in BGR space.
    Same logic as small ball detection.
    """
    # Convert to float for distance calculation
    img_float = image.astype(np.float32)
    target = np.array(target_bgr, dtype=np.float32)

    # Euclidean distance from target color
    diff = img_float - target
    distance = np.sqrt(np.sum(diff ** 2, axis=2))

    # Create binary mask
    mask = (distance < threshold).astype(np.uint8) * 255

    # Morphological cleanup
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    # Find contours
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if len(contours) < 2:
        return [], mask

    # Sort by area, get top 2
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:2]

    markers = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 100:  # Skip tiny noise
            continue

        # Get center using moments
        M = cv2.moments(cnt)
        if M["m00"] > 0:
            cx = int(M["m10"] / M["m00"])
            cy = int(M["m01"] / M["m00"])

            # Get bounding circle radius
            (_, _), radius = cv2.minEnclosingCircle(cnt)

            markers.append({
                'center': (cx, cy),
                'radius': radius,
                'area': area
            })

    # Sort by y-coordinate (marker with lower y = higher on screen = y-axis marker)
    markers = sorted(markers, key=lambda m: m['center'][1])

    return markers, mask


def mouse_callback(event, x, y, flags, param):
    global box_pos, box_size

    if event == cv2.EVENT_LBUTTONDOWN:
        # Click to move box center to this position
        box_pos[0] = x
        box_pos[1] = y
        print(f"Box moved to: ({x}, {y})")

    elif event == cv2.EVENT_MOUSEWHEEL:
        # Resize box with scroll
        if flags > 0:
            box_size = min(50, box_size + 5)
        else:
            box_size = max(30, box_size - 5)
        print(f"Box size: {box_size}x{box_size}")


def draw_ui(image):
    """Draw the selection box and detection results."""
    display = image.copy()
    h, w = display.shape[:2]

    # Clamp box center to image bounds
    half = box_size // 2
    box_pos[0] = max(half, min(w - half, box_pos[0]))
    box_pos[1] = max(half, min(h - half, box_pos[1]))

    # Get top-left corner
    tl_x, tl_y = get_box_topleft()

    # Draw selection box
    cv2.rectangle(display,
                  (tl_x, tl_y),
                  (tl_x + box_size, tl_y + box_size),
                  (0, 255, 0), 2)

    # Draw crosshair at box center
    cx, cy = box_pos[0], box_pos[1]
    cv2.line(display, (cx - 10, cy), (cx + 10, cy), (0, 255, 0), 1)
    cv2.line(display, (cx, cy - 10), (cx, cy + 10), (0, 255, 0), 1)

    # Draw box size label
    cv2.putText(display, f"{box_size}x{box_size}px",
                (tl_x, tl_y - 5),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)

    # Draw average color if computed
    if avg_color is not None:
        # Color swatch
        cv2.rectangle(display, (10, 10), (60, 60), tuple(avg_color), -1)
        cv2.rectangle(display, (10, 10), (60, 60), (255, 255, 255), 2)
        cv2.putText(display, f"BGR: {avg_color}", (70, 40),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

    # Draw detected markers
    if detected_markers:
        for i, marker in enumerate(detected_markers):
            cx, cy = marker['center']
            r = int(marker['radius'])

            # Draw circle
            cv2.circle(display, (cx, cy), r, (0, 0, 255), 2)
            cv2.circle(display, (cx, cy), 5, (0, 0, 255), -1)

            # Label
            label = "Y-axis" if i == 0 else "X-axis"
            cv2.putText(display, label, (cx + 10, cy - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)

        # Draw connecting line if we have 2 markers
        if len(detected_markers) >= 2:
            p1 = detected_markers[0]['center']
            p2 = detected_markers[1]['center']
            # Draw outline for visibility
            cv2.line(display, p1, p2, (0, 0, 0), 6)
            # Draw main line (cyan for visibility)
            cv2.line(display, p1, p2, (255, 255, 0), 4)

            # Draw distance
            dist = np.sqrt((p2[0] - p1[0])**2 + (p2[1] - p1[1])**2)
            mid = ((p1[0] + p2[0]) // 2, (p1[1] + p2[1]) // 2)
            cv2.putText(display, f"{dist:.1f}px", (mid[0] + 10, mid[1]),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 4)
            cv2.putText(display, f"{dist:.1f}px", (mid[0] + 10, mid[1]),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 0), 2)

    # Instructions
    instructions = [
        "Click to move box | Scroll to resize",
        "D: Detect | R: Reset | Q: Quit"
    ]
    for i, text in enumerate(instructions):
        cv2.putText(display, text, (10, h - 30 + i * 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

    return display


def main():
    global avg_color, detected_markers

    if len(sys.argv) < 2:
        print("Usage: python test_marker_detection.py <image_path>")
        print("Example: python test_marker_detection.py tests/test_image.jpg")
        sys.exit(1)

    image_path = sys.argv[1]

    if not Path(image_path).exists():
        print(f"Error: Image not found: {image_path}")
        sys.exit(1)

    # Load image
    image = cv2.imread(image_path)
    if image is None:
        print(f"Error: Could not load image: {image_path}")
        sys.exit(1)

    print(f"Loaded image: {image_path}")
    print(f"Size: {image.shape[1]}x{image.shape[0]}")

    # Resize image if too large (keeps coordinates consistent)
    h, w = image.shape[:2]
    max_dim = 1000
    if w > max_dim or h > max_dim:
        scale = min(max_dim / w, max_dim / h)
        image = cv2.resize(image, (int(w * scale), int(h * scale)))
        print(f"Resized to: {image.shape[1]}x{image.shape[0]}")

    # Create window - use AUTOSIZE to prevent coordinate issues
    cv2.namedWindow("Marker Detection Test", cv2.WINDOW_AUTOSIZE)
    cv2.setMouseCallback("Marker Detection Test", mouse_callback)

    mask_window = None

    while True:
        display = draw_ui(image)
        cv2.imshow("Marker Detection Test", display)

        if mask_window is not None:
            cv2.imshow("Detection Mask", mask_window)

        key = cv2.waitKey(30) & 0xFF

        if key == ord('q'):
            break

        elif key == ord('d'):
            # Extract average color and detect
            tl_x, tl_y = get_box_topleft()
            avg_color = extract_average_color(image, tl_x, tl_y, box_size)
            if avg_color:
                print(f"\nSelected color (BGR): {avg_color}")
                print("Detecting markers...")

                detected_markers, mask = detect_markers_euclidean(image, avg_color, threshold=35)
                mask_window = mask

                if len(detected_markers) >= 2:
                    print(f"SUCCESS! Found {len(detected_markers)} markers:")
                    for i, m in enumerate(detected_markers):
                        label = "Y-axis" if i == 0 else "X-axis"
                        print(f"  {label}: center={m['center']}, radius={m['radius']:.1f}, area={m['area']:.0f}")

                    p1 = detected_markers[0]['center']
                    p2 = detected_markers[1]['center']
                    dist = np.sqrt((p2[0] - p1[0])**2 + (p2[1] - p1[1])**2)
                    print(f"  Distance: {dist:.1f}px")
                else:
                    print(f"FAILED: Only found {len(detected_markers)} marker(s)")
                    print("Try adjusting the box position or using a different threshold")

        elif key == ord('r'):
            # Reset
            avg_color = None
            detected_markers = []
            mask_window = None
            cv2.destroyWindow("Detection Mask")
            print("Reset")

        elif key == ord('t'):
            # Try different thresholds
            if avg_color:
                print("\nTrying different thresholds...")
                for thresh in [25, 30, 35, 40, 45, 50]:
                    markers, _ = detect_markers_euclidean(image, avg_color, threshold=thresh)
                    print(f"  Threshold {thresh}: found {len(markers)} marker(s)")

    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
