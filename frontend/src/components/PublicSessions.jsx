import React, {useEffect, useState} from 'react';
import {getPublicSessions} from '../utils/api';
import {getWebSocketUrl} from '../utils/config';
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
            .catch(() => {});

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
                }
            };

            socket.onclose = () => {
                if (!cancelled) retryTimer = setTimeout(connect, RECONNECT_MS);
            };
        };

        connect();

        return () => {
            cancelled = true;
            clearTimeout(retryTimer);
            if (socket) {
                socket.onclose = null;
                socket.close();
            }
        };
    }, []);

    return sessions;
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
    const time = date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
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
    const sessions = useLobby();
    useTick(TICK_MS);

    // Nothing published means nothing to show — the section itself appears and
    // disappears with the rooms.
    if (sessions.length === 0) return null;

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
