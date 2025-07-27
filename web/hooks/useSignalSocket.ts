"use client";
import { useEffect, useRef, useState } from "react";
import * as mediasoup from "mediasoup-client";

export type WSMessage =
  | { type: "createSendTransport" }
  | { type: "createRecvTransport" }
  | { type: "connectSendTransport", data: mediasoup.types.DtlsParameters }
  | { type: "connectRecvTransport", data: mediasoup.types.DtlsParameters }
  | { type: "produce", data: { kind: "audio" | "video", rtpParameters: mediasoup.types.RtpParameters } }
  | { type: "consume", data: { producerId: string, rtpCapabilities: mediasoup.types.RtpCapabilities } }
  | { type: "routerRtpCapabilities", data: mediasoup.types.RtpCapabilities }
  | { type: "sendTransportCreated", data: { id: string, iceParameters: mediasoup.types.IceParameters, iceCandidates: mediasoup.types.IceCandidate[], dtlsParameters: mediasoup.types.DtlsParameters } }
  | { type: "recvTransportCreated", data: { id: string, iceParameters: mediasoup.types.IceParameters, iceCandidates: mediasoup.types.IceCandidate[], dtlsParameters: mediasoup.types.DtlsParameters } }
  | { type: "produced", data: { producerId: string } }
  | { type: "consumed", data: { producerId: string, id: string, kind: mediasoup.types.MediaKind, rtpParameters: mediasoup.types.RtpParameters } }
  | { type: "newProducer", data: { producerId: string, kind: mediasoup.types.MediaKind } }
  | { type: "cannotConsume" };


export function useSignalSocket(onMessage: (msg: WSMessage) => void) {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080");
    socketRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "join" }));
    };

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
