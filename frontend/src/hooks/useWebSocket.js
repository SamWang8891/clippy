import {useEffect, useRef, useState} from 'react';
import {getBackendUrl} from '../utils/config';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
// Closes that happen before the socket ever opens look like either a server
// rejection (e.g. 403 from a stale session) or the network being down. After
// this many in a row we assume the stored session is dead and bail out so the
// caller can reset state instead of looping forever.
const UNOPENED_CLOSE_LIMIT = 5;

export function useWebSocket(sessionId, userId, onMessage, onAuthRejected, onResync) {
    const [isConnected, setIsConnected] = useState(false);
    const wsRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);
    const pingIntervalRef = useRef(null);
    // Latest handlers in refs so changing them does not tear down the socket.
    const onMessageRef = useRef(onMessage);
    const onAuthRejectedRef = useRef(onAuthRejected);
    const onResyncRef = useRef(onResync);

    useEffect(() => {
        onMessageRef.current = onMessage;
    }, [onMessage]);

    useEffect(() => {
        onAuthRejectedRef.current = onAuthRejected;
    }, [onAuthRejected]);

    useEffect(() => {
        onResyncRef.current = onResync;
    }, [onResync]);

    useEffect(() => {
        if (!sessionId || !userId) return;

        let cancelled = false;
        let attempt = 0;
        let unopenedCloses = 0;
        let openedThisAttempt = false;

        const scheduleReconnect = () => {
            if (cancelled) return;
            // Exponential backoff with full jitter, capped at RECONNECT_MAX_MS.
            const cap = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
            attempt += 1;
            const delay = Math.floor(Math.random() * cap);
            reconnectTimeoutRef.current = setTimeout(connect, delay);
        };

        const connect = () => {
            if (cancelled) return;

            openedThisAttempt = false;

            const apiUrl = getBackendUrl();
            const wsUrl = apiUrl.replace(/^https/, 'wss').replace(/^http/, 'ws');
            const fullWsUrl = `${wsUrl}/ws/${sessionId}`;

            // The member token goes in the subprotocol, not the path: browsers
            // can't set headers on a WS handshake, and a token in the URL lands
            // in every proxy access log. The server echoes it back on accept.
            wsRef.current = new WebSocket(fullWsUrl, [userId]);

            wsRef.current.onopen = () => {
                const reconnected = attempt > 0;
                attempt = 0;
                openedThisAttempt = true;
                unopenedCloses = 0;
                setIsConnected(true);
                // Events published while the socket was down are gone for good,
                // so a reconnect has to re-read state rather than assume none.
                if (reconnected) onResyncRef.current?.();

                pingIntervalRef.current = setInterval(() => {
                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({type: 'ping'}));
                    }
                }, 30000);
            };

            wsRef.current.onmessage = (event) => {
                let message;
                try {
                    message = JSON.parse(event.data);
                } catch (err) {
                    console.warn('Invalid WebSocket payload:', err);
                    return;
                }
                if (message.type !== 'pong') {
                    onMessageRef.current?.(message);
                }
            };

            wsRef.current.onclose = () => {
                setIsConnected(false);
                if (pingIntervalRef.current) {
                    clearInterval(pingIntervalRef.current);
                    pingIntervalRef.current = null;
                }
                if (!openedThisAttempt) {
                    unopenedCloses += 1;
                    if (unopenedCloses >= UNOPENED_CLOSE_LIMIT) {
                        cancelled = true;
                        onAuthRejectedRef.current?.();
                        return;
                    }
                }
                scheduleReconnect();
            };

            wsRef.current.onerror = () => {
                setIsConnected(false);
            };
        };

        connect();

        return () => {
            cancelled = true;
            if (pingIntervalRef.current) {
                clearInterval(pingIntervalRef.current);
                pingIntervalRef.current = null;
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
            if (wsRef.current) {
                wsRef.current.onclose = null;
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [sessionId, userId]);

    return {isConnected};
}
