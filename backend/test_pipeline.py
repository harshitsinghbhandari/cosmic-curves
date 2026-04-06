import os
import io
import time
import requests
from PIL import Image, ImageDraw

API_BASE = "http://127.0.0.1:8000"

def generate_frame(index, total):
    img = Image.new('RGB', (800, 600), color='white')
    draw = ImageDraw.Draw(img)
    frac = index / float(total - 1)
    x_offset = -200 + 400 * frac
    y_offset = 0.005 * (x_offset**2) - 100
    cx = 400 + x_offset
    cy = 300 - y_offset
    r = 20
    draw.ellipse([(cx-r, cy-r), (cx+r, cy+r)], fill=(255, 165, 0)) # orange
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=85)
    return buf.getvalue()

def test_pipeline():
    print("Beginning synthetic test pipeline...")
    
    print("1. Creating session...")
    r = requests.post(f"{API_BASE}/session/new")
    r.raise_for_status()
    session_data = r.json()
    code = session_data["session_code"]
    print(f"Session code: {code}")
    
    headers = {"X-Session-Code": code}
    
    print("2. Calibrating...")
    img = Image.new('RGB', (800, 600), color='white')
    draw = ImageDraw.Draw(img)
    draw.ellipse([(400-45, 300-45), (400+45, 300+45)], fill='black')
    buf = io.BytesIO()
    img.save(buf, format='JPEG')
    
    r = requests.post(f"{API_BASE}/calibrate", headers=headers, data=buf.getvalue())
    r.raise_for_status()
    print("Calibration response:", r.json())
    
    print("3. Setup colors...")
    setup_data = {
        "small_ball_hsv": {"h": 30, "s": 255, "v": 255}, 
        "sheet_hsv": {"h": 0, "s": 0, "v": 255}, 
        "big_ball_hsv": {"h": 0, "s": 0, "v": 0} 
    }
    
    print("Sending preview frame...")
    preview_bytes = generate_frame(15, 30)
    requests.post(f"{API_BASE}/detect_preview", headers=headers, data=preview_bytes)
    
    r = requests.post(f"{API_BASE}/setup", headers=headers, json=setup_data)
    print("Setup response:", r.json())
    
    print("4. Streaming 30 synthetic frames...")
    for i in range(30):
        frame_bytes = generate_frame(i, 30)
        h = headers.copy()
        h["X-Frame-Index"] = str(i)
        r = requests.post(f"{API_BASE}/frame", headers=h, data=frame_bytes)
        
    print("5. Stopping and waiting for pipeline...")
    r = requests.post(f"{API_BASE}/stop", headers=headers)
    print("Stop response:", r.json())
    
    while True:
        r = requests.get(f"{API_BASE}/status", headers=headers)
        status = r.json()
        print("Status:", status)
        if status["status"] == "done":
            break
        elif status["status"] == "error":
            print("Pipeline failed!")
            return
        time.sleep(0.5)
        
    run_id = status["run_id"]
    r = requests.get(f"{API_BASE}/runs/{run_id}")
    run = r.json()
    print("\n--- TEST SUCCESS ---")
    print(f"Winning Curve: {run['winning_curve']}")
    print(f"Equation: {run['equation']['display']}")
    print("Residuals:", run['residuals'])

if __name__ == "__main__":
    test_pipeline()
