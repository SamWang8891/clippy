import React, { createContext, useContext, useState, useEffect } from 'react';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [sessionData, setSessionData] = useState(() => {
    const saved = localStorage.getItem('clippy_session');
    return saved ? JSON.parse(saved) : null;
  });

  useEffect(() => {
    if (sessionData) {
      localStorage.setItem('clippy_session', JSON.stringify(sessionData));
    } else {
      localStorage.removeItem('clippy_session');
    }
  }, [sessionData]);

  const clearSession = () => {
    setSessionData(null);
  };

  return (
    <SessionContext.Provider value={{ sessionData, setSessionData, clearSession }}>
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
