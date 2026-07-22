import React, {useEffect, useState} from 'react';
import {SessionProvider, useSession} from './context/SessionContext';
import {ToastProvider} from './context/ToastContext';
import {ConfirmProvider, useConfirm} from './context/ConfirmContext';
import {SessionEntry} from './components/SessionEntry';
import {ClipboardInterface} from './components/ClipboardInterface';
import {getSession} from './utils/api';
import {initConfig} from './utils/config';

// The id in the URL, if the path looks like one. `/r/<id>/<code>` raw links and
// anything else with a slash are excluded by the character class.
function urlSessionId() {
    const id = window.location.pathname.replace(/^\//, '').trim().toLowerCase();
    return /^[a-z0-9]+$/.test(id) ? id : null;
}

function AppContent() {
    const {sessionData, clearSession} = useSession();
    const confirm = useConfirm();
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                await initConfig();
            } catch (err) {
                console.error('Failed to initialize:', err);
            }
            // A saved session plus a *different* id in the URL — scanning a new
            // QR while an old session is still stored — is ambiguous. Without
            // this the stored session always won, the URL was ignored, and the
            // only thing the user saw was the old session reported as expired.
            const newId = urlSessionId();
            if (sessionData && newId && newId !== sessionData.connection_id) {
                const oldId = sessionData.connection_id;
                const oldAlive = await getSession(oldId, sessionData.user_id).then(() => true, () => false);
                const shown = oldAlive ? <code>{oldId}</code> : <s><code>{oldId}</code></s>;
                const goNew = await confirm({
                    title: 'Open the new connection?',
                    message: (
                        <>
                            You already have connection {shown}{oldAlive ? '' : ' open but expired'}.
                            {' '}Open <code>{newId}</code> instead?
                        </>
                    ),
                    confirmText: 'Open new',
                    cancelText: 'Stay',
                    confirmStyle: 'primary',
                });
                if (goNew) {
                    clearSession(); // SessionEntry joins from the URL on mount
                } else {
                    window.history.replaceState({}, '', `/${oldId}`);
                }
            }
            setIsReady(true);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!isReady) {
        return (
            <div className="app-layout">
                <div className="app-loading">Loading…</div>
            </div>
        );
    }

    return (
        <div className="app-layout">
            <main className="app-main">
                {sessionData ? <ClipboardInterface/> : <SessionEntry/>}
            </main>
            {!sessionData && (
                <footer className="app-footer">
                    <span className="app-footer-version">Clippy v2.0.1</span>
                    <a
                        className="app-footer-repo"
                        href="https://github.com/SamWang8891/clippy"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <svg
                            className="app-footer-icon"
                            viewBox="0 0 16 16"
                            aria-hidden="true"
                            focusable="false"
                        >
                            <path
                                fillRule="evenodd"
                                d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0016 8c0-4.42-3.58-8-8-8z"
                            />
                        </svg>
                        <span>SamWang8891/clippy</span>
                    </a>
                </footer>
            )}
        </div>
    );
}

function App() {
    return (
        <SessionProvider>
            <ToastProvider>
                <ConfirmProvider>
                    <AppContent/>
                </ConfirmProvider>
            </ToastProvider>
        </SessionProvider>
    );
}

export default App;
