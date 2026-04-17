import {useEffect, useRef, useState} from 'react';
import {getBackendUrl} from '../utils/config';

export function useWebSocket(sessionId, userId, onMessage) {
    const [isConnected, setIsConnected] = useState(false);
    const wsRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);
    const pingIntervalRef = useRef(null);
    // Latest onMessage handler in a ref so changing it does not tear down the socket.
    const onMessageRef = useRef(onMessage);

    useEffect(() => {
        onMessageRef.current = onMessage;
    }, [onMessage]);

    useEffect(() => {
        if (!sessionId || !userId) return;

        let cancelled = false;

        const connect = () => {
            if (cancelled) return;

            const apiUrl = getBackendUrl();
            const wsUrl = apiUrl.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
            const fullWsUrl = `${wsUrl}/ws/${sessionId}/${userId}`;

            console.log('Connecting to WebSocket:', fullWsUrl);
            wsRef.current = new WebSocket(fullWsUrl);

            wsRef.current.onopen = () => {
                setIsConnected(true);

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

                if (!cancelled) {
                    reconnectTimeoutRef.current = setTimeout(connect, 3000);
                }
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
