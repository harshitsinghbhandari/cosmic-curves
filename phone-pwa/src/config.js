// Phone PWA Configuration
// Uses Vite environment variables - automatically switches between dev/prod

export const CONFIG = {
    // API Base URL - reads from .env.development or .env.production
    API_BASE: import.meta.env.VITE_API_BASE || "http://localhost:8000",

    // Environment info (for debugging)
    IS_DEV: import.meta.env.DEV,
    IS_PROD: import.meta.env.PROD,
};

// Log config in development
if (import.meta.env.DEV) {
    console.log("[Config] Environment:", import.meta.env.MODE);
    console.log("[Config] API Base:", CONFIG.API_BASE);
}
