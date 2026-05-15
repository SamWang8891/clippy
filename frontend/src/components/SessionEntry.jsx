import React, {useEffect, useState} from 'react';
import {createSession, getConnectionIdLength, joinSession} from '../utils/api';
import {useSession} from '../context/SessionContext';
import './SessionEntry.css';

function syncUrl(connectionId) {
    window.history.replaceState({}, '', `/${connectionId}`);
}

export function SessionEntry() {
    const [mode, setMode] = useState('create');
    const [userName, setUserName] = useState('');
    const [sessionId, setSessionId] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [idLength, setIdLength] = useState(6);
    const {setSessionData} = useSession();

    useEffect(() => {
        getConnectionIdLength().then(setIdLength).catch(() => {});
    }, []);

    useEffect(() => {
        const pathname = window.location.pathname;
        const urlSessionId = pathname.replace('/', '').trim().toLowerCase();

        const pattern = new RegExp(`^[a-z0-9]{${idLength}}$`);
        if (urlSessionId && urlSessionId.length === idLength && pattern.test(urlSessionId)) {
            setMode('join');
            setSessionId(urlSessionId);
            setLoading(true);
            setError('');
            joinSession(urlSessionId, null)
                .then((data) => {
                    syncUrl(data.connection_id);
                    setSessionData(data);
                })
                .catch((err) => setError(err.message))
                .finally(() => setLoading(false));
        }
    }, [idLength, setSessionData]);

    const handleCreate = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const data = await createSession(userName || null);
            syncUrl(data.connection_id);
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
            syncUrl(data.connection_id);
            setSessionData(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const placeholder = '_'.repeat(idLength);

    return (
        <div className="entry">
            <header className="entry-head">
                <h1 className="entry-word">Clippy</h1>
                <p className="entry-sub">Secure collaborative clipboard.</p>
            </header>

            <div className="entry-tabs" role="tablist">
                <button
                    role="tab"
                    aria-selected={mode === 'create'}
                    className={`entry-tab ${mode === 'create' ? 'is-active' : ''}`}
                    onClick={() => setMode('create')}
                    type="button"
                >
                    New
                </button>
                <button
                    role="tab"
                    aria-selected={mode === 'join'}
                    className={`entry-tab ${mode === 'join' ? 'is-active' : ''}`}
                    onClick={() => setMode('join')}
                    type="button"
                >
                    Join
                </button>
            </div>

            {mode === 'create' ? (
                <form onSubmit={handleCreate} className="entry-form">
                    <div className="entry-field">
                        <label htmlFor="entry-name">Name <span className="entry-optional">optional</span></label>
                        <input
                            id="entry-name"
                            type="text"
                            value={userName}
                            onChange={(e) => setUserName(e.target.value)}
                            placeholder="Leave blank for assigned name"
                            disabled={loading}
                        />
                    </div>
                    <button className="entry-submit" type="submit" disabled={loading}>
                        {loading ? 'Creating…' : 'Create connection'}
                    </button>
                </form>
            ) : (
                <form onSubmit={handleJoin} className="entry-form">
                    <div className="entry-field">
                        <label htmlFor="entry-id">Connection ID</label>
                        <input
                            id="entry-id"
                            className="entry-input-mono"
                            type="text"
                            value={sessionId}
                            onChange={(e) => setSessionId(e.target.value.toLowerCase())}
                            placeholder={placeholder}
                            maxLength={idLength}
                            required
                            disabled={loading}
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellCheck="false"
                        />
                    </div>
                    <div className="entry-field">
                        <label htmlFor="entry-name-join">Name <span className="entry-optional">optional</span></label>
                        <input
                            id="entry-name-join"
                            type="text"
                            value={userName}
                            onChange={(e) => setUserName(e.target.value)}
                            placeholder="Leave blank for assigned name"
                            disabled={loading}
                        />
                    </div>
                    <button
                        className="entry-submit"
                        type="submit"
                        disabled={loading || sessionId.length !== idLength}
                    >
                        {loading ? 'Joining…' : 'Join connection'}
                    </button>
                </form>
            )}

            {error && (
                <div className="entry-error" role="alert">
                    <span className="entry-error-label">Error —</span> {error}
                </div>
            )}
        </div>
    );
}
