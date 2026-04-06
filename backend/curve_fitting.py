"""
Curve Fitting Module

This module provides functions for fitting different mathematical curves
(parabolas, ellipses, hyperbolas) to a set of coordinates.
Uses numpy for polynomial fitting and SVD for conic section fitting.
"""

import numpy as np
from scipy.optimize import least_squares

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
    
    # Determine the winning model by the lowest residual
    residuals = {k: v["residual"] for k, v in results.items()}
    winner = min(residuals, key=residuals.get)
    
    return {
        "winning_curve": winner,
        "residuals": residuals,
        "equation": results[winner]["equation"]
    }
