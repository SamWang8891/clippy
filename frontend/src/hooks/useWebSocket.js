import { useEffect, useRef, useState } from 'react';
import { getBackendUrl } from '../utils/config';

export function useWebSocket(sessionId, userId, onMessage) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const pingIntervalRef = useRef(null);

  useEffect(() => {
    if (!sessionId || !userId) return;

    const connect = () => {
      // Get backend URL from runtime config
      const apiUrl = getBackendUrl();
      const wsUrl = apiUrl.replace('http://', 'ws://').replace('https://', 'wss://');
      const fullWsUrl = `${wsUrl}/ws/${sessionId}/${userId}`;

      console.log('Connecting to WebSocket:', fullWsUrl);
      wsRef.current = new WebSocket(fullWsUrl);

      wsRef.current.onopen = () => {
        setIsConnected(true);

        // Start ping interval to keep connection alive
        pingIntervalRef.current = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000); // Ping every 30 seconds
      };

      wsRef.current.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type !== 'pong') {
          onMessage(message);
        }
      };

      wsRef.current.onclose = () => {
        setIsConnected(false);
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }

        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      };

      wsRef.current.onerror = () => {
        setIsConnected(false);
      };
    };

    connect();

    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [sessionId, userId, onMessage]);

  return { isConnected };
}
