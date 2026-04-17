import React, {useEffect, useState} from 'react';
import {SessionProvider, useSession} from './context/SessionContext';
import {ToastProvider} from './context/ToastContext';
import {ConfirmProvider} from './context/ConfirmContext';
import {SessionEntry} from './components/SessionEntry';
import {ClipboardInterface} from './components/ClipboardInterface';
import {Footer} from './components/Footer';
import {initConfig} from './utils/config';

function AppContent() {
    const {sessionData} = useSession();
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        // Resolve the backend URL. Encryption keys are per-session and set
        // when a session is created or joined, not at app startup.
        initConfig()
            .then(() => setIsReady(true))
            .catch((err) => {
                console.error('Failed to initialize:', err);
                setIsReady(true); // Still show UI with fallback config
            });
    }, []);

    if (!isReady) {
        return (
            <div className="app-layout">
                <div className="app-loading">
                    Loading...
                </div>
                <Footer />
            </div>
        );
    }

    return (
        <div className="app-layout">
            <main className="app-main">
                {sessionData ? <ClipboardInterface/> : <SessionEntry/>}
            </main>
            <Footer />
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
