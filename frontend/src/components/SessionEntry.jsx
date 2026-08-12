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

/**
 * The one connection-ID input, used by both tabs so New and Join cannot drift
 * apart.
 *
 * It is a password field on purpose. Nothing here is secret — that is the only
 * control macOS and Windows drop out of a Chinese IME for, and no web API
 * exposes that switch (`ime-mode` has been dead for years). Chrome then refuses
 * to unmask it from CSS, so the dots are hidden by painting the text
 * transparent and the real value is echoed by the span underneath, which mirrors
 * the input's font, padding and letter-spacing exactly.
 *
 * `sanitize` runs on composition end as well as on change: it is the backstop
 * for any browser that lets an IME compose into the field anyway.
 *
 * Trade-off: assistive tech announces this as a password field and will not
 * read the characters back.
 */
function ConnectionIdField({inputId, value, sanitize, onChange, placeholder, disabled, required}) {
    const apply = (e) => onChange(sanitize(e.target.value));
    return (
        <div className="entry-field">
            <label htmlFor={inputId}>Connection ID</label>
            <div className="entry-code-wrap">
                <input
                    id={inputId}
                    className="entry-input-mono entry-input-code"
                    type="password"
                    value={value}
                    onChange={apply}
                    onCompositionEnd={apply}
                    placeholder={placeholder}
                    required={required}
                    disabled={disabled}
                    lang="en"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck="false"
                    // Nothing to remember here; keep the password managers that
                    // a type=password field attracts out of it. Each vendor has
                    // its own opt-out and ignores everyone else's. None of them
                    // covers the browser's own "save password?" prompt — there
                    // is no supported way to decline that.
                    autoComplete="off"
                    data-1p-ignore=""
                    data-lpignore="true"
                    data-bwignore="true"
                    data-protonpass-ignore="true"
                    data-form-type="other"
                />
                <span className="entry-code-echo" aria-hidden="true">{value}</span>
            </div>
        </div>
    );
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

    // Only what the server will accept survives being typed or pasted.
    const sanitizeId = (value) => value
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
                    <ConnectionIdField
                        inputId="entry-custom-id"
                        value={customId}
                        sanitize={sanitizeId}
                        onChange={setCustomId}
                        placeholder={placeholder}
                        disabled={loading}
                    />
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
                    <ConnectionIdField
                        inputId="entry-id"
                        value={sessionId}
                        sanitize={sanitizeId}
                        onChange={setSessionId}
                        placeholder={placeholder}
                        disabled={loading}
                        required
                    />
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
