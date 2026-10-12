import React, {useEffect, useRef, useState} from 'react';
import {enterSession, getConnectionIdRules, joinSession} from '../utils/api';
import {useSession} from '../context/SessionContext';
import {NO_PASSWORD_MANAGERS} from '../utils/autofill';
import {PublicSessions} from './PublicSessions';
import {IconButton} from './IconButton';
import {ArrowRight} from './animate-ui/icons/arrow-right';
import {Layers} from './animate-ui/icons/layers';
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

export function storeName(name) {
    try {
        localStorage.setItem(NAME_STORAGE_KEY, name);
    } catch {
        /* nothing to do — the name is a convenience, not state we depend on */
    }
}

/**
 * The connection-ID input.
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
function ConnectionIdField({inputId, inputRef, value, sanitize, onChange, placeholder, disabled}) {
    const apply = (e) => onChange(sanitize(e.target.value));
    return (
        <div className="entry-field">
            <label htmlFor={inputId}>Connection ID</label>
            <div className="entry-code-wrap">
                <input
                    ref={inputRef}
                    id={inputId}
                    className="entry-input-mono entry-input-code"
                    type="password"
                    value={value}
                    onChange={apply}
                    onCompositionEnd={apply}
                    placeholder={placeholder}
                    disabled={disabled}
                    lang="en"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck="false"
                    // Nothing to remember here, but a type=password field draws
                    // every password manager. one-time-code is what keeps the
                    // browser's own out: Chromium's form parser classes such a
                    // field as not-a-password, so it never offers to save it
                    // (autocomplete=off is ignored on password fields). The
                    // extensions each read their own opt-out instead.
                    autoComplete="one-time-code"
                    {...NO_PASSWORD_MANAGERS}
                />
                <span className="entry-code-echo" aria-hidden="true">{value}</span>
            </div>
        </div>
    );
}

export function SessionEntry() {
    const [userName, setUserName] = useState(readStoredName);
    const [sessionId, setSessionId] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [idRules, setIdRules] = useState(DEFAULT_ID_RULES);
    const idInputRef = useRef(null);
    const {setSessionData} = useSession();

    // Persisted on every change, including when cleared: an empty field is a
    // deliberate "give me a random name", not a reason to resurrect the old one.
    useEffect(() => {
        storeName(userName);
    }, [userName]);

    useEffect(() => {
        getConnectionIdRules().then(setIdRules).catch(() => {});
    }, []);

    // The ID is what nearly everyone came to type. Refocused whenever a request
    // settles too — a disabled field drops focus, so a rejected ID would
    // otherwise leave the caret nowhere.
    useEffect(() => {
        if (!loading) idInputRef.current?.focus();
    }, [loading]);

    // Arriving at /<id> only ever joins. A link that outlived its session, or
    // a refresh after it expired, must not quietly mint a new room in its
    // place; the ID stays in the field, one press away from creating it.
    useEffect(() => {
        const pathname = window.location.pathname;
        const urlSessionId = pathname.replace('/', '').trim().toLowerCase();

        const pattern = new RegExp(`^[a-z0-9]{${idRules.length}}$`);
        if (urlSessionId && urlSessionId.length === idRules.length && pattern.test(urlSessionId)) {
            setSessionId(urlSessionId);
            setLoading(true);
            setError('');
            // Arriving by QR or a shared link is the common way in, and it used
            // to be the one path that ignored the remembered name.
            joinSession(urlSessionId, readStoredName() || null)
                .then((data) => {
                    syncUrl(data.connection_id);
                    setSessionData(data);
                })
                .catch((err) => setError(err.message))
                .finally(() => setLoading(false));
        }
    }, [idRules.length, setSessionData]);

    const connect = async (request) => {
        setLoading(true);
        setError('');
        try {
            const data = await request();
            syncUrl(data.connection_id);
            setSessionData(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // Whether this joins or creates is the server's call: a live ID joins it,
    // a free one creates it, a blank one creates a room under a generated ID.
    const handleSubmit = (e) => {
        e.preventDefault();
        connect(() => enterSession(sessionId || null, userName || null));
    };

    // A lobby row is a room someone published; if it has gone in the
    // meantime, saying so beats creating an empty one under its name.
    const joinById = (id) => connect(() => joinSession(id, userName || null));

    // Only what the server will accept survives being typed or pasted.
    const sanitizeId = (value) => value
        .toLowerCase()
        .split('')
        .filter((c) => idRules.alphabet.includes(c))
        .join('')
        .slice(0, idRules.length);

    const placeholder = '_'.repeat(idRules.length);
    const idIncomplete = sessionId.length > 0 && sessionId.length !== idRules.length;

    return (
        <div className="entry">
            <header className="entry-head">
                <h1 className="entry-word">
                    {/* The stack fans out once as the page settles in. */}
                    <Layers className="entry-mark" size={32} animate="default-loop" delay={260} aria-hidden="true" />
                    Clippy
                </h1>
                <p className="entry-sub">Secure collaborative clipboard.</p>
            </header>

            <form onSubmit={handleSubmit} className="entry-form">
                <ConnectionIdField
                    inputId="entry-id"
                    inputRef={idInputRef}
                    value={sessionId}
                    sanitize={sanitizeId}
                    onChange={setSessionId}
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
                        autoComplete="off"
                        {...NO_PASSWORD_MANAGERS}
                    />
                </div>
                <IconButton
                    icon={ArrowRight}
                    size={18}
                    iconEnd
                    className="entry-submit"
                    type="submit"
                    disabled={loading || idIncomplete}
                >
                    {loading ? 'Connecting…' : 'Connect'}
                </IconButton>
            </form>

            {error && (
                <div className="entry-error" role="alert">
                    <span className="entry-error-label">Error —</span> {error}
                </div>
            )}

            <PublicSessions onJoin={joinById} disabled={loading} />
        </div>
    );
}
