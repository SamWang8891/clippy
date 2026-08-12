/**
 * Runtime configuration fetcher.
 *
 * The frontend is built once and deployed anywhere, so the backend URL is
 * resolved at runtime from a sibling `config.json`. The build-time
 * `VITE_API_URL` env var is used as a fallback so `vite dev` and tests work.
 */

let backendUrl = null;

/**
 * Initialize configuration. Returns the resolved backend URL.
 */
export async function initConfig() {
    const candidates = [
        '/config.json',
        import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/config.json` : null,
    ].filter(Boolean);

    for (const url of candidates) {
        try {
            const response = await fetch(url);
            if (!response.ok) continue;
            const config = await response.json();
            if (config && typeof config.url === 'string' && config.url.trim()) {
                backendUrl = config.url.trim();
                console.log('Backend URL loaded from config.json:', backendUrl);
                return backendUrl;
            }
        } catch (err) {
            console.warn(`Failed to fetch config from ${url}:`, err.message);
        }
    }

    backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:8123';
    console.log('Backend URL fallback to env:', backendUrl);
    return backendUrl;
}

export function getBackendUrl() {
    if (!backendUrl) {
        throw new Error('Config not initialized. Call initConfig() first.');
    }
    return backendUrl;
}

/**
 * Backend URL with the scheme swapped for WebSockets. Anchored to the scheme so
 * a host containing "http" later in the URL is left alone.
 */
export function getWebSocketUrl() {
    return getBackendUrl().replace(/^https/, 'wss').replace(/^http/, 'ws');
}
