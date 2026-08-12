import React, {createContext, useContext, useEffect, useState} from 'react';

const SessionContext = createContext(null);

export function SessionProvider({children}) {
    const [sessionData, setSessionData] = useState(() => {
        // A throw in a useState initializer kills the first render and leaves a
        // permanent white screen, so bad stored JSON must not propagate.
        try {
            const saved = localStorage.getItem('clippy_session');
            return saved ? JSON.parse(saved) : null;
        } catch {
            localStorage.removeItem('clippy_session');
            return null;
        }
    });

    useEffect(() => {
        if (sessionData) {
            localStorage.setItem('clippy_session', JSON.stringify(sessionData));
        } else {
            localStorage.removeItem('clippy_session');
        }
    }, [sessionData]);

    const clearSession = () => {
        // Cleared here as well as in the effect above: callers reload the page
        // immediately after this, which can beat React's effect flush and leave
        // the dead session in storage to be restored on the next load.
        try {
            localStorage.removeItem('clippy_session');
        } catch {
            /* storage disabled — the effect below is the only other writer */
        }
        setSessionData(null);
    };

    return (
        <SessionContext.Provider value={{sessionData, setSessionData, clearSession}}>
            {children}
        </SessionContext.Provider>
    );
}

export function useSession() {
    const context = useContext(SessionContext);
    if (!context) {
        throw new Error('useSession must be used within SessionProvider');
    }
    return context;
}
