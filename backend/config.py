# Backend Configuration
# Uses environment variables with sensible defaults

import os

# ===========================================
# Environment Detection
# ===========================================
ENV = os.environ.get("ENV", "development")  # "development" or "production"
IS_DEV = ENV == "development"
IS_PROD = ENV == "production"

# ===========================================
# URL Configuration
# ===========================================

# Development defaults (localhost)
DEV_BACKEND_URL = "http://localhost:8000"
DEV_PHONE_PWA_URL = "http://localhost:3001"
DEV_LAPTOP_PWA_URL = "http://localhost:3000"

# Production defaults (your deployed URLs)
PROD_BACKEND_URL = "https://cosmic-curves.onrender.com"
PROD_PHONE_PWA_URL = "https://cosmic-curves.vercel.app/phone"
PROD_LAPTOP_PWA_URL = "https://cosmic-curves.vercel.app/laptop"

# Active URLs (can be overridden via environment variables)
BACKEND_URL = os.environ.get(
    "BACKEND_URL",
    DEV_BACKEND_URL if IS_DEV else PROD_BACKEND_URL
)

PHONE_PWA_URL = os.environ.get(
    "PHONE_PWA_URL",
    DEV_PHONE_PWA_URL if IS_DEV else PROD_PHONE_PWA_URL
)

LAPTOP_PWA_URL = os.environ.get(
    "LAPTOP_PWA_URL",
    DEV_LAPTOP_PWA_URL if IS_DEV else PROD_LAPTOP_PWA_URL
)

# ===========================================
# Server Configuration
# ===========================================
BACKEND_PORT = int(os.environ.get("PORT", 8000))
LAPTOP_PWA_PORT = 3000
PHONE_PWA_PORT = 3001

# For local network access (used in dev)
INTERNAL_IP = os.environ.get("INTERNAL_IP", "127.0.0.1")

# ===========================================
# Logging
# ===========================================
def log_config():
    """Print current configuration for debugging."""
    print(f"[Config] ENV: {ENV}")
    print(f"[Config] BACKEND_URL: {BACKEND_URL}")
    print(f"[Config] PHONE_PWA_URL: {PHONE_PWA_URL}")
    print(f"[Config] LAPTOP_PWA_URL: {LAPTOP_PWA_URL}")

# Log on import in development
if IS_DEV:
    log_config()
