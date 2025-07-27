"use client";
import { useEffect, useRef, useState } from "react";

export type WSMessage =
  | { type: "welcome"; peerId: string }
  | { type: "pong" }
  | { type: "join" | "leave"; peerId: string }
  | { type: "signal"; peerId: string; payload: unknown };

export function useSignalSocket(onMessage: (msg: WSMessage) => void) {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080");
    socketRef.current = ws;

    ws.onopen = () => 
      setConnected(true);
      ws.send(JSON.stringify({ type: "join" }));
    ;

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data) as WSMessage;
        onMessage(msg);
      } catch (e) {
        console.error("Bad WS message", e);
      }
    };

    ws.onclose = () => setConnected(false);
    ws.onerror  = () => setConnected(false);

    return () => ws.close();
  }, [onMessage]);

  function send(msg: unknown) {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(msg));
    }
  }

  return { connected, send };
}
