/**
 * Runtime configuration fetcher.
 *
 * Fetches config.yaml from the backend at runtime to get the backend URL.
 * This allows the frontend to be built once and deployed anywhere.
 */

let backendUrl = null;

/**
 * Initialize configuration by fetching config.yaml from the backend.
 * Uses VITE_API_URL as fallback if config.yaml fetch fails.
 *
 * @returns {Promise<string>} The backend URL
 */
export async function initConfig() {
  // Try to fetch from multiple potential locations
  const configUrls = [
    '/config.yaml',  // Same origin
    import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/config.yaml` : null,
  ].filter(Boolean);

  for (const url of configUrls) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const yamlText = await response.text();
        // Simple YAML parsing for our basic config structure
        const match = yamlText.match(/url:\s*["']?([^"'\n]+)["']?/);
        if (match) {
          backendUrl = match[1].trim();
          console.log('Backend URL loaded from config.yaml:', backendUrl);
          return backendUrl;
        }
      }
    } catch (err) {
      console.warn(`Failed to fetch config from ${url}:`, err.message);
    }
  }

  // Fallback to environment variable
  backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:8123';
  console.log('Backend URL fallback to env:', backendUrl);
  return backendUrl;
}

/**
 * Get the configured backend URL.
 *
 * @returns {string} The backend URL
 * @throws {Error} If config hasn't been initialized
 */
export function getBackendUrl() {
  if (!backendUrl) {
    throw new Error('Config not initialized. Call initConfig() first.');
  }
  return backendUrl;
}
