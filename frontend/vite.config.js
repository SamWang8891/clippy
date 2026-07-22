import {readFileSync} from 'node:fs'
import {defineConfig, loadEnv} from 'vite'
import react from '@vitejs/plugin-react'

// Single source of truth for the version the UI displays. Resolved relative to
// this file rather than cwd, so it survives being built from anywhere.
const {version} = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig(({mode}) => {
    const env = loadEnv(mode, process.cwd(), '')
    const apiUrl = env.VITE_API_URL || 'http://localhost:8123'
    // `replace('http', 'ws')` would also rewrite "http" appearing later in the URL.
    // Anchor to the scheme so e.g. https://api.example.com -> wss://api.example.com.
    const wsUrl = apiUrl.replace(/^https/, 'wss').replace(/^http/, 'ws')

    return {
        plugins: [react()],
        define: {__APP_VERSION__: JSON.stringify(version)},
        server: {
            port: 3000,
            proxy: {
                '/api/v2': {
                    target: apiUrl,
                    changeOrigin: true,
                },
                '/r/': {
                    target: apiUrl,
                    changeOrigin: true,
                },
                '/ws': {
                    target: wsUrl,
                    ws: true,
                },
            },
        },
    }
})
