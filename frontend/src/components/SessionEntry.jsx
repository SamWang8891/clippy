import React, { useState } from 'react';
import { createSession, joinSession } from '../utils/api';
import { useSession } from '../context/SessionContext';
import './SessionEntry.css';

export function SessionEntry() {
  const [mode, setMode] = useState('create');
  const [userName, setUserName] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { setSessionData } = useSession();

  const handleCreate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const data = await createSession(userName || null);
      setSessionData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const data = await joinSession(sessionId, userName || null);
      setSessionData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="session-entry">
      <div className="session-entry-card">
        <h1>Clippy</h1>
        <p className="subtitle">Secure Collaborative Clipboard</p>

        <div className="mode-tabs">
          <button
            className={mode === 'create' ? 'active' : ''}
            onClick={() => setMode('create')}
          >
            Create Session
          </button>
          <button
            className={mode === 'join' ? 'active' : ''}
            onClick={() => setMode('join')}
          >
            Join Session
          </button>
        </div>

        {mode === 'create' ? (
          <form onSubmit={handleCreate} className="session-form">
            <div className="form-group">
              <label>Your Name (optional)</label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Leave empty for random name"
                disabled={loading}
              />
            </div>
            <button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Session'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleJoin} className="session-form">
            <div className="form-group">
              <label>Session ID</label>
              <input
                type="text"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value.toLowerCase())}
                placeholder="Enter 6-character session ID"
                maxLength={6}
                required
                disabled={loading}
              />
            </div>
            <div className="form-group">
              <label>Your Name (optional)</label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Leave empty for random name"
                disabled={loading}
              />
            </div>
            <button type="submit" disabled={loading || sessionId.length !== 6}>
              {loading ? 'Joining...' : 'Join Session'}
            </button>
          </form>
        )}

        {error && <div className="error-message">{error}</div>}
      </div>
    </div>
  );
}
