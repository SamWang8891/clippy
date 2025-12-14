import React, { useEffect, useState } from 'react';
import { SessionProvider, useSession } from './context/SessionContext';
import { SessionEntry } from './components/SessionEntry';
import { ClipboardInterface } from './components/ClipboardInterface';
import { initConfig } from './utils/config';
import { initEncryption } from './utils/encryption';

function AppContent() {
  const { sessionData } = useSession();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Initialize config first, then encryption
    initConfig()
      .then(() => initEncryption())
      .then(() => setIsReady(true))
      .catch((err) => {
        console.error('Failed to initialize:', err);
        setIsReady(true); // Still show UI with fallback config
      });
  }, []);

  if (!isReady) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontSize: '18px',
        color: '#666'
      }}>
        Loading...
      </div>
    );
  }

  return sessionData ? <ClipboardInterface /> : <SessionEntry />;
}

function App() {
  return (
    <SessionProvider>
      <AppContent />
    </SessionProvider>
  );
}

export default App;
