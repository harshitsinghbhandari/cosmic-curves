import numpy as np
import cv2
from scipy.optimize import least_squares


def convert_numpy_types(obj):
    """Recursively convert numpy types to native Python types for JSON serialization."""
    if isinstance(obj, dict):
        return {k: convert_numpy_types(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_numpy_types(v) for v in obj]
    elif isinstance(obj, (np.integer, np.int32, np.int64)):
        return int(obj)
    elif isinstance(obj, (np.floating, np.float32, np.float64)):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    return obj


def fit_curves(coordinates: list) -> dict:
    """
    Fit multiple curves to provided coordinates and return the best fitting one.

    Fits parabolas, and when enough points are available, conic sections (ellipses/hyperbolas).
    Identifies the "winner" by the lowest mean squared error (residual).

    Args:
        coordinates: List of dictionaries with 'x_cm' and 'y_cm' keys.

    Returns:
        dict: Fitting results including winning_curve, residuals for all types,
              and equation details (type, coefficients, and display string).
    """
    x_array = np.array([p['x_cm'] for p in coordinates])
    y_array = np.array([p['y_cm'] for p in coordinates])

    results = {}
    
    # --- Parabola Fitting ---
    # Fit y = ax² + bx + c
    coeffs = np.polyfit(x_array, y_array, deg=2)
    a, b, c = coeffs
    predicted_y = np.polyval(coeffs, x_array)
    parabola_residual = float(np.mean((y_array - predicted_y) ** 2))
    
    results['parabola'] = {
        "residual": parabola_residual,
        "equation": {
            "type": "parabola",
            "coefficients": {"a": round(float(a), 3), "b": round(float(b), 3), "c": round(float(c), 3)},
            "display": f"y = {a:.3f}x² + {b:.3f}x + {c:.3f}"
        }
    }
    
    # --- Conic Section Fitting (Ellipse/Hyperbola) using SVD ---
    # Fits Ax² + Bxy + Cy² + Dx + Ey + F = 0
    N = len(x_array)
    if N >= 6:  # Need at least 6 points to fit a general conic
        # Design matrix D
        D_mat = np.zeros((N, 6))
        D_mat[:, 0] = x_array**2
        D_mat[:, 1] = x_array * y_array
        D_mat[:, 2] = y_array**2
        D_mat[:, 3] = x_array
        D_mat[:, 4] = y_array
        D_mat[:, 5] = np.ones(N)
        
        # Solve via Singular Value Decomposition
        _, _, Vt = np.linalg.svd(D_mat)
        v = Vt[-1, :]  # Right singular vector corresponding to the smallest singular value
        A, B, C, D, E, F = v
        
        # Classify by discriminant: B² - 4AC
        discriminant = B**2 - 4*A*C
        
        # Compute mean squared residual error
        conic_residual = float(np.mean(np.abs(
            A*x_array**2 + B*x_array*y_array + C*y_array**2 + D*x_array + E*y_array + F
        )))

        # Determine conic type
        if discriminant < 0:
            c_type = "ellipse"
        else:
            c_type = "hyperbola"
            
        results[c_type] = {
            "residual": conic_residual,
            "equation": {
                "type": c_type,
                "coefficients": {
                    "A": round(float(A),3), "B": round(float(B),3), "C": round(float(C),3),
                    "D": round(float(D),3), "E": round(float(E),3), "F": round(float(F),3)
                },
                "display": f"{A:.3f}x² + {B:.3f}xy + {C:.3f}y² + {D:.3f}x + {E:.3f}y + {F:.3f} = 0"
            }
        }

    # Determine winning curve by minimum residual
    winning_curve = min(results.keys(), key=lambda k: results[k]['residual'])

    # Build final result with winning_curve and residuals summary
    result = {
        "winning_curve": winning_curve,
        "equation": results[winning_curve]["equation"],
        "residuals": {k: results[k]["residual"] for k in results},
        "all_fits": results
    }

    # Convert all numpy types to native Python types for JSON serialization
    return convert_numpy_types(result)


def draw_physics_overlay(image, result, origin_x, origin_y, px_per_cm, coordinates):
    """
    Draw the mathematical curve and detected points on the image.
    
    Args:
        image: OpenCV image array (BGR)
        result: Result dict from fit_curves()
        origin_x, origin_y: Origin coordinates in pixels
        px_per_cm: Calibration factor
        coordinates: List of {'x_cm', 'y_cm'} dicts
    """
    h, w = image.shape[:2]
    color_curve = (255, 0, 255) # Magenta for the math
    color_pts = (0, 255, 0)     # Green for detections
    
    # 1. Draw the detected points
    for p in coordinates:
        px = int(p['x_cm'] * px_per_cm + origin_x)
        py = int(origin_y - p['y_cm'] * px_per_cm)
        if 0 <= px < w and 0 <= py < h:
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

            # Skip if qa is zero (degenerate conic)
            if abs(qa) < 1e-10:
                continue

            det = qb**2 - 4 * qa * qc
            if det >= 0:
                sqrt_det = np.sqrt(det)
                for sign in [1, -1]:
                    y = (-qb + sign * sqrt_det) / (2 * qa)
                    px = int(x * px_per_cm + origin_x)
                    py = int(origin_y - y * px_per_cm)
                    if 0 <= px < w and 0 <= py < h:
                        cv2.circle(image, (px, py), 1, color_curve, -1)

    # Add labels
    cv2.putText(image, f"Model: {winner.upper()}", (30, 40), 
                cv2.FONT_HERSHEY_SIMPLEX, 1.0, color_curve, 2)
    cv2.putText(image, result['equation']['display'], (30, 75), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, color_curve, 1)
