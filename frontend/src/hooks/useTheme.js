import {useCallback, useEffect, useState} from 'react';

const STORAGE_KEY = 'theme';

function readStored() {
    try {
        const value = localStorage.getItem(STORAGE_KEY);
        if (value === 'light' || value === 'dark') return value;
    } catch {
        /* localStorage unavailable */
    }
    return 'system';
}

function systemPrefersDark() {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(theme) {
    if (theme === 'light' || theme === 'dark') return theme;
    return systemPrefersDark() ? 'dark' : 'light';
}

function apply(resolved) {
    if (typeof document !== 'undefined') {
        document.documentElement.dataset.theme = resolved;
    }
}

export function useTheme() {
    const [theme, setThemeState] = useState(() => readStored());
    const [resolved, setResolved] = useState(() => resolve(readStored()));

    useEffect(() => {
        const next = resolve(theme);
        setResolved(next);
        apply(next);
    }, [theme]);

    useEffect(() => {
        if (theme !== 'system') return undefined;
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => {
            const next = systemPrefersDark() ? 'dark' : 'light';
            setResolved(next);
            apply(next);
        };
        media.addEventListener('change', handler);
        return () => media.removeEventListener('change', handler);
    }, [theme]);

    const setTheme = useCallback((next) => {
        setThemeState(next);
        try {
            if (next === 'system') {
                localStorage.removeItem(STORAGE_KEY);
            } else {
                localStorage.setItem(STORAGE_KEY, next);
            }
        } catch {
            /* localStorage unavailable */
        }
    }, []);

    return {theme, resolved, setTheme};
}
