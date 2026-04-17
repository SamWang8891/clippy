import React, {useEffect, useState} from 'react';
import {createSession, getConnectionIdLength, joinSession} from '../utils/api';
import {useSession} from '../context/SessionContext';
import {generateSessionKey} from '../utils/encryption';
import './SessionEntry.css';

/**
 * Read the encryption key from the URL fragment (`#key`). The fragment is
 * never sent to the server, so the key stays on the client side.
 */
function readKeyFromHash() {
    if (typeof window === 'undefined' || !window.location.hash) return null;
    return window.location.hash.replace(/^#/, '').trim() || null;
}

/**
 * Replace the URL with `/{connectionId}#{key}` without triggering navigation.
 */
function syncUrl(connectionId, key) {
    const hash = key ? `#${key}` : '';
    window.history.replaceState({}, '', `/${connectionId}${hash}`);
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

    // If the URL points at a connection, auto-join. The encryption key, when
    // present, is in the URL fragment.
    useEffect(() => {
        const pathname = window.location.pathname;
        const urlSessionId = pathname.replace('/', '').trim().toLowerCase();

        const pattern = new RegExp(`^[a-z0-9]{${idLength}}$`);
        if (urlSessionId && urlSessionId.length === idLength && pattern.test(urlSessionId)) {
            setMode('join');
            setSessionId(urlSessionId);
            setLoading(true);
            setError('');
            const keyFromHash = readKeyFromHash();
            joinSession(urlSessionId, null)
                .then((data) => {
                    const enriched = {...data, encryption_key: keyFromHash};
                    syncUrl(enriched.connection_id, keyFromHash);
                    setSessionData(enriched);
                })
                .catch((err) => {
                    setError(err.message);
                })
                .finally(() => {
                    setLoading(false);
                });
        }
    }, [idLength]);

    const handleCreate = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const key = generateSessionKey();
            const data = await createSession(userName || null);
            const enriched = {...data, encryption_key: key};
            syncUrl(enriched.connection_id, key);
            setSessionData(enriched);
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
            // Manual ID entry has no key — user can join but won't be able to
            // decrypt blocks unless they obtain the key out-of-band.
            const enriched = {...data, encryption_key: null};
            syncUrl(enriched.connection_id, null);
            setSessionData(enriched);
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
                        Create Connection
                    </button>
                    <button
                        className={mode === 'join' ? 'active' : ''}
                        onClick={() => setMode('join')}
                    >
                        Join Connection
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
                            {loading ? 'Creating...' : 'Create Connection'}
                        </button>
                    </form>
                ) : (
                    <form onSubmit={handleJoin} className="session-form">
                        <div className="form-group">
                            <label>Connection ID</label>
                            <input
                                type="text"
                                value={sessionId}
                                onChange={(e) => setSessionId(e.target.value.toLowerCase())}
                                placeholder={`Enter ${idLength}-character connection ID`}
                                maxLength={idLength}
                                required
                                disabled={loading}
                            />
                            <small style={{color: '#888', display: 'block', marginTop: '4px'}}>
                                Tip: open the full share URL to decrypt content automatically.
                            </small>
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
                        <button type="submit" disabled={loading || sessionId.length !== idLength}>
                            {loading ? 'Joining...' : 'Join Connection'}
                        </button>
                    </form>
                )}

                {error && <div className="error-message">{error}</div>}
            </div>
        </div>
    );
}
