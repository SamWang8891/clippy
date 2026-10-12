import React, {useEffect, useState} from 'react';
import {getPublicSessions} from '../utils/api';
import {AnimatePresence, motion} from 'motion/react';
import {configReady, getWebSocketUrl} from '../utils/config';
import {LoaderCircle} from './animate-ui/icons/loader-circle';
import {formatClock} from '../utils/time';
import './PublicSessions.css';

const RECONNECT_MS = 3000;
// Relative timestamps go stale on their own, so re-render them on a slow tick
// rather than waiting for the server to push an update the room may never make.
const TICK_MS = 30000;

/**
 * Live list of sessions their host has published.
 *
 * The socket carries the whole list on every change, so there is no merge step
 * — appearances and disappearances land as a straight replacement.
 */
function useLobby() {
    const [sessions, setSessions] = useState([]);
    // Until the first answer, from either the snapshot or the socket. A failed
    // snapshot counts too: the list is optional, and a spinner that never
    // stops would be worse than no list.
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        let socket = null;
        let retryTimer = null;
        // The REST snapshot is only a fallback for when the socket can't open;
        // it must never overwrite a list the socket already delivered.
        let live = false;

        getPublicSessions()
            .then((initial) => {
                if (!cancelled && !live) setSessions(initial);
            })
            .catch(() => {})
            .finally(() => {
                if (!cancelled) setLoaded(true);
            });

        const connect = () => {
            if (cancelled) return;
            try {
                socket = new WebSocket(`${getWebSocketUrl()}/ws/lobby`);
            } catch {
                // A lobby that cannot connect is a missing list, not a broken
                // entry page — keep retrying quietly behind the form.
                retryTimer = setTimeout(connect, RECONNECT_MS);
                return;
            }

            socket.onmessage = (event) => {
                let message;
                try {
                    message = JSON.parse(event.data);
                } catch {
                    return;
                }
                if (message.type === 'public_sessions') {
                    live = true;
                    setSessions(message.sessions ?? []);
                    setLoaded(true);
                }
            };

            socket.onclose = () => {
                if (!cancelled) retryTimer = setTimeout(connect, RECONNECT_MS);
            };
        };

        configReady().then(connect);

        return () => {
            cancelled = true;
            clearTimeout(retryTimer);
            if (socket) {
                socket.onclose = null;
                socket.close();
            }
        };
    }, []);

    return {sessions, loaded};
}

function useTick(intervalMs) {
    const [, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTick((n) => n + 1), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
}

function formatCreated(iso) {
    const date = new Date(iso);
    const time = formatClock(date);
    if (date.toDateString() === new Date().toDateString()) return time;
    return `${date.toLocaleDateString([], {month: 'short', day: '2-digit'})} ${time}`;
}

function formatRelative(iso) {
    const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    return `${Math.round(minutes / 60)} hr ago`;
}

export function PublicSessions({onJoin, disabled}) {
    const {sessions, loaded} = useLobby();
    useTick(TICK_MS);

    // The spinner holds the list's place while it loads, so the page around it
    // is drawn once and never shifts. Nothing published means nothing to show:
    // the section appears and disappears with the rooms.
    return (
        <AnimatePresence mode="wait" initial={false}>
            {!loaded ? (
                <motion.div
                    key="loading"
                    className="lobby-loading"
                    role="status"
                    aria-label="Loading"
                    exit={{opacity: 0, transition: {duration: 0.12}}}
                >
                    <LoaderCircle size={18} animate aria-hidden="true" />
                </motion.div>
            ) : sessions.length > 0 ? (
                <motion.div key="list" initial={{opacity: 0}} animate={{opacity: 1}} transition={{duration: 0.18}}>
                    <LobbyList sessions={sessions} onJoin={onJoin} disabled={disabled} />
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}

function LobbyList({sessions, onJoin, disabled}) {
    return (
        <section className="lobby" aria-label="Public connections">
            <h2 className="lobby-title">Public Clippys</h2>
            <ul className="lobby-list">
                {sessions.map((entry) => (
                    <li key={entry.connection_id}>
                        <button
                            type="button"
                            className="lobby-row"
                            disabled={disabled}
                            onClick={() => onJoin(entry.connection_id)}
                        >
                            <span className="lobby-name">{entry.name}</span>
                            <span className="lobby-id">{entry.connection_id}</span>
                            <span className="lobby-meta">
                                <span className="lobby-time">
                                    <span className="lobby-label">Created:</span>
                                    {formatCreated(entry.created_at)}
                                </span>
                                <span className="lobby-time is-end">
                                    {formatRelative(entry.last_activity)}
                                </span>
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
