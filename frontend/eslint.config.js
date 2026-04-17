import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
    js.configs.recommended,
    {
        files: ['src/**/*.{js,jsx}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: {
                ecmaFeatures: {jsx: true},
            },
            globals: {
                window: 'readonly',
                document: 'readonly',
                console: 'readonly',
                fetch: 'readonly',
                navigator: 'readonly',
                localStorage: 'readonly',
                sessionStorage: 'readonly',
                URL: 'readonly',
                URLSearchParams: 'readonly',
                Blob: 'readonly',
                FormData: 'readonly',
                File: 'readonly',
                FileReader: 'readonly',
                Uint8Array: 'readonly',
                TextEncoder: 'readonly',
                TextDecoder: 'readonly',
                WebSocket: 'readonly',
                crypto: 'readonly',
                btoa: 'readonly',
                atob: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
            },
        },
        plugins: {
            react,
            'react-hooks': reactHooks,
        },
        settings: {
            react: {version: 'detect'},
        },
        rules: {
            ...react.configs.recommended.rules,
            ...reactHooks.configs.recommended.rules,
            'react/react-in-jsx-scope': 'off',
            'react/prop-types': 'off',
            'no-unused-vars': ['warn', {argsIgnorePattern: '^_'}],
        },
    },
];
