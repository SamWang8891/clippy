import {defineConfig, loadEnv} from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({mode}) => {
    const env = loadEnv(mode, process.cwd(), '')
    const apiUrl = env.VITE_API_URL || 'http://localhost:8123'
    // `replace('http', 'ws')` would also rewrite "http" appearing later in the URL.
    // Anchor to the scheme so e.g. https://api.example.com -> wss://api.example.com.
    const wsUrl = apiUrl.replace(/^https/, 'wss').replace(/^http/, 'ws')

    return {
        plugins: [react()],
        server: {
            port: 3000,
            proxy: {
                '/api/v1': {
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
