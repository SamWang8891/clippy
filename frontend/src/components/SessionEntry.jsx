import React, {useEffect, useState} from 'react';
import {createSession, getConnectionIdRules, joinSession} from '../utils/api';
import {useSession} from '../context/SessionContext';
import {PublicSessions} from './PublicSessions';
import './SessionEntry.css';

const NAME_STORAGE_KEY = 'clippy_user_name';
const DEFAULT_ID_RULES = {length: 6, alphabet: 'abcdefghijklmnopqrstuvwxyz0123456789'};

function syncUrl(connectionId) {
    window.history.replaceState({}, '', `/${connectionId}`);
}

// localStorage throws in private-mode Safari and when storage is disabled, and
// a throw in a useState initializer leaves a permanent white screen.
function readStoredName() {
    try {
        return localStorage.getItem(NAME_STORAGE_KEY) ?? '';
    } catch {
        return '';
    }
}

function storeName(name) {
    try {
        localStorage.setItem(NAME_STORAGE_KEY, name);
    } catch {
        /* nothing to do — the name is a convenience, not state we depend on */
    }
}

export function SessionEntry() {
    const [mode, setMode] = useState('create');
    const [userName, setUserName] = useState(readStoredName);
    const [sessionId, setSessionId] = useState('');
    const [customId, setCustomId] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [idRules, setIdRules] = useState(DEFAULT_ID_RULES);
    const {setSessionData} = useSession();

    // Persisted on every change, including when cleared: an empty field is a
    // deliberate "give me a random name", not a reason to resurrect the old one.
    useEffect(() => {
        storeName(userName);
    }, [userName]);

    useEffect(() => {
        getConnectionIdRules().then(setIdRules).catch(() => {});
    }, []);

    useEffect(() => {
        const pathname = window.location.pathname;
        const urlSessionId = pathname.replace('/', '').trim().toLowerCase();

        const pattern = new RegExp(`^[a-z0-9]{${idRules.length}}$`);
        if (urlSessionId && urlSessionId.length === idRules.length && pattern.test(urlSessionId)) {
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
    }, [idRules.length, setSessionData]);

    const handleCreate = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const data = await createSession(userName || null, customId || null);
            syncUrl(data.connection_id);
            setSessionData(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const joinById = async (id) => {
        setLoading(true);
        setError('');
        try {
            const data = await joinSession(id, userName || null);
            syncUrl(data.connection_id);
            setSessionData(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleJoin = (e) => {
        e.preventDefault();
        joinById(sessionId);
    };

    // A chosen ID has to be one the server will accept, so drop anything outside
    // its alphabet as it is typed. The join field stays lenient by comparison:
    // an ID minted before those characters were retired must still be reachable.
    const sanitizeCustomId = (value) => value
        .toLowerCase()
        .split('')
        .filter((c) => idRules.alphabet.includes(c))
        .join('')
        .slice(0, idRules.length);

    const placeholder = '_'.repeat(idRules.length);
    const customIdIncomplete = customId.length > 0 && customId.length !== idRules.length;

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
                    <div className="entry-field">
                        {/* The rule lives in the label, not a hint line below it,
                            so New and Join stay exactly the same height. */}
                        <label htmlFor="entry-custom-id">
                            Connection ID
                            <span className="entry-optional">optional · no I O 0 1 E</span>
                        </label>
                        <input
                            id="entry-custom-id"
                            className="entry-input-mono"
                            type="text"
                            value={customId}
                            onChange={(e) => setCustomId(sanitizeCustomId(e.target.value))}
                            placeholder="Leave blank for random ID"
                            maxLength={idRules.length}
                            disabled={loading}
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellCheck="false"
                        />
                    </div>
                    <button
                        className="entry-submit"
                        type="submit"
                        disabled={loading || customIdIncomplete}
                    >
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
                            maxLength={idRules.length}
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
                        disabled={loading || sessionId.length !== idRules.length}
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

            <PublicSessions onJoin={joinById} disabled={loading} />
        </div>
    );
}
