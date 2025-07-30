"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import * as mediasoupClient from "mediasoup-client";
import { useSignalSocket, WSMessage } from "@/hooks/useSignalSocket";

export default function StreamPage() {
  const localVideoRef  = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [device, setDevice] = useState<mediasoupClient.Device>();
  const [rtpCaps, setRtpCaps] = useState<mediasoupClient.types.RtpCapabilities>();
  const [sendTransport, setSendTransport] = useState<mediasoupClient.types.Transport>();
  const [recvTransport, setRecvTransport] = useState<mediasoupClient.types.Transport>();
  const [consumers, setConsumers] = useState<mediasoupClient.types.Consumer[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream>();
  const [remoteStream, setRemoteStream] = useState<MediaStream>();
  const [pendingProducers, setPendingProducers] = useState<string[]>([]);
  const pendingProduceCallbacksRef = useRef<((data: { id: string }) => void)[]>([]);

  const onMessage = useCallback((msg: WSMessage) => {
    console.log("[WSMessage received]", msg);
    switch (msg.type) {
      case "routerRtpCapabilities":
        {
          (async () => {
            try {
              const dev = new mediasoupClient.Device();
              await dev.load({ routerRtpCapabilities: msg.data });
              setDevice(dev);
              setRtpCaps(msg.data);

              send({ type: "createSendTransport" });
              send({ type: "createRecvTransport" });
            } catch (error) {
              console.error("Failed to load device:", error);
            }
          })();
        }
        break;

      case "sendTransportCreated":
        {
          const { id, iceParameters, iceCandidates, dtlsParameters } = msg.data;
          console.log("[sendTransportCreated] Received:", msg.data);
          if (!device) {
            console.error("[sendTransportCreated] No device available - this should not happen");
            return;
          }
          const transport = device.createSendTransport({ id, iceParameters, iceCandidates, dtlsParameters });
          console.log("[sendTransportCreated] Created sendTransport:", transport);

          transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
            console.log("[sendTransport] on connect", dtlsParameters);
            try {
              send({ type: "connectSendTransport", data: dtlsParameters });
              callback();
              console.log("[sendTransport] connect callback called");
            } catch (error) {
              console.error("[sendTransport] connect error:", error);
              errback(error as Error);
            }
          });
          transport.on("produce", async ({ kind, rtpParameters }, callback, errback) => {
            console.log("[sendTransport] on produce", { kind, rtpParameters });
            try {
              // Store callback in ref (immediate, no async state update)
              pendingProduceCallbacksRef.current.push(callback);
              console.log("[sendTransport] Stored callback, total pending:", pendingProduceCallbacksRef.current.length);
              
              send({ type: "produce", data: { kind, rtpParameters } });
              console.log("[sendTransport] Sent produce message, waiting for server producer ID");
            } catch (error) {
              console.error("[sendTransport] produce error:", error);
              errback(error as Error);
            }
          });
          setSendTransport(transport);
        }
        break;

      case "recvTransportCreated":
        {
          const { id, iceParameters, iceCandidates, dtlsParameters } = msg.data;
          console.log("[recvTransportCreated] Received:", msg.data);
          if (!device) {
            console.error("[recvTransportCreated] No device available - this should not happen");
            return;
          }
          const transport = device.createRecvTransport({ id, iceParameters, iceCandidates, dtlsParameters });
          console.log("[recvTransportCreated] Created recvTransport:", transport);

          transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
            console.log("[recvTransport] on connect", dtlsParameters);
            try {
              send({ type: "connectRecvTransport", data: dtlsParameters });
              callback();
              console.log("[recvTransport] connect callback called");
            } catch (error) {
              console.error("[recvTransport] connect error:", error);
              errback(error as Error);
            }
          });
          setRecvTransport(transport);
        }
        break;

      case "newProducer":
        {
          // someone else started producing — consume it
          console.log("[newProducer] Received:", msg.data);
          if (recvTransport && rtpCaps) {
            send({ type: "consume", data: { 
              producerId: msg.data.producerId, 
              rtpCapabilities: rtpCaps 
            }});
          } else {
            console.warn("[newProducer] Cannot consume yet - adding to pending list");
            setPendingProducers(prev => [...prev, msg.data.producerId]);
          }
        }
        break;

      case "consumed":
        {
          (async () => {
            try {
              const { id, producerId, kind, rtpParameters } = msg.data;
              console.log("[consumed] Received:", msg.data);
              if (!recvTransport) {
                console.warn("[consumed] No recvTransport available");
                return;
              }
              const consumer = await recvTransport.consume({ id, producerId, kind, rtpParameters});
              await consumer.resume();
              console.log("[consumed] Consumer resumed, track:", consumer.track);
              console.log("[consumed] Track enabled:", consumer.track.enabled, "muted:", consumer.track.muted, "readyState:", consumer.track.readyState);
              setConsumers(prev => [...prev, consumer]);
              console.log("[consumed] Added consumer for", kind, "track");
            } catch (error) {
              console.error("Failed to consume:", error);
            }
          })();
        }
        break;

      case "produced":
        {
          const { producerId } = msg.data;
          console.log("[produced] Got producer ID from server:", producerId);
          
          // Get first pending callback and call it with server producer ID
          console.log("[produced] Available callbacks:", pendingProduceCallbacksRef.current.length);
          if (pendingProduceCallbacksRef.current.length > 0) {
            const callback = pendingProduceCallbacksRef.current.shift()!;
            callback({ id: producerId });
            console.log("[produced] ✅ Called callback with REAL producer ID from server:", producerId);
          } else {
            console.error("[produced] ❌ No pending callbacks for producer ID:", producerId);
          }
        }
        break;

      default:
        console.warn("[WSMessage] Unknown type:", msg.type);
    }
  }, [device, rtpCaps, recvTransport]);

  const { connected, send } = useSignalSocket(onMessage);

  // Handle remote stream creation from consumers
  useEffect(() => {
    if (consumers.length > 0) {
      const tracks = consumers.map(consumer => consumer.track);
      console.log("[remoteStream] All tracks:", tracks.map(t => ({ kind: t.kind, enabled: t.enabled, muted: t.muted, readyState: t.readyState })));

      if (tracks.length === 0) {
        console.warn("[remoteStream] No tracks found");
        return;
      }
      
      const videoTracks = tracks.filter(t => t.kind === 'video');
      const audioTracks = tracks.filter(t => t.kind === 'audio');
      console.log("[remoteStream] Video tracks:", videoTracks.map(t => ({ id: t.id, enabled: t.enabled, muted: t.muted, readyState: t.readyState })));
      console.log("[remoteStream] Audio tracks:", audioTracks.map(t => ({ id: t.id, enabled: t.enabled, muted: t.muted, readyState: t.readyState })));

      console.log("[remoteStream] Using", tracks.length, "tracks out of", tracks.length, "total");
      
      const stream = new MediaStream(tracks);
      setRemoteStream(stream);
      if (remoteVideoRef.current) {
        console.log("[remoteStream] Setting remote stream srcObject", remoteVideoRef.current);
        remoteVideoRef.current.srcObject = stream;
        console.log("[remoteStream] Attached remote stream with", tracks.length, "tracks");
        console.log("[remoteStream] Video element srcObject set:", remoteVideoRef.current.srcObject);
        console.log("[remoteStream] Video element paused:", remoteVideoRef.current.paused);
        // remoteVideoRef.current.play().catch(console.error);
        // console.log("[remoteStream] Video playing successfully");
        
      } else {
        console.warn("[remoteStream] remoteVideoRef.current is null");
      }
    }
  }, [consumers]);

  // Process pending producers when recvTransport becomes available
  useEffect(() => {
    if (recvTransport && rtpCaps && pendingProducers.length > 0) {
      console.log("[pendingProducers] Processing", pendingProducers.length, "pending producers");
      pendingProducers.forEach(producerId => {
        send({ type: "consume", data: { 
          producerId, 
          rtpCapabilities: rtpCaps 
        }});
      });
      setPendingProducers([]);
    }
  }, [recvTransport, rtpCaps, pendingProducers, send]);

  useEffect(() => {
    console.log("[useEffect sendTransport] sendTransport:", sendTransport, "localStream:", localStream);
    if (!sendTransport || !localStream) return;
    
    (async () => {
      try {
        const tracks = localStream.getTracks();
        console.log("[useEffect sendTransport] Producing tracks:", tracks);
        for (const track of tracks) {
          console.log("[useEffect sendTransport] Producing track:", track);
          console.log("[useEffect sendTransport] Track details:", {
            kind: track.kind,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState,
            label: track.label
          });
          if (!sendTransport) {
            console.warn("[useEffect sendTransport] No sendTransport available");
            return;
          }
          const producer = await sendTransport.produce({ track });
          console.log("[useEffect sendTransport] Producer created:", {
            id: producer.id,
            kind: producer.kind,
            paused: producer.paused,
            track: producer.track
          });
          console.log("[useEffect sendTransport] Producer", producer);
          console.log("[useEffect sendTransport] Produced track:", track);
        }
      } catch (error) {
        console.error("Failed to produce:", error);
      }
    })();
  }, [sendTransport, localStream]);

  // initial getUserMedia
  useEffect(() => {
    (async () => {
      try {
        console.log("[getUserMedia] Requesting user media");
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        console.log("[getUserMedia] Got stream:", stream);
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          console.log("[getUserMedia] Set local video srcObject");
        } else {
          console.warn("[getUserMedia] localVideoRef.current is null");
        }
      } catch (error) {
        console.error("Failed to get user media:", error);
      }
    })();
  }, []);


  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-4">
        <div>
          <h2>Your Video</h2>
          <video 
            ref={localVideoRef} 
            autoPlay 
            muted 
            playsInline 
            className="w-80 h-60 border-4 border-blue-500 bg-gray-200 object-cover"
          />
        </div>
        <div>
          <h2>Peer Video</h2>
          <div className="relative">
            <video 
              ref={remoteVideoRef} 
              autoPlay 
              playsInline 
              className="w-80 h-60 border-4 border-red-500 object-cover" 
            />
          </div>
        </div>
      </div>
      <button 
        disabled={consumers.length === 0}
        onClick={() => {
          remoteVideoRef.current?.play();
          console.log("[remoteStream] Video playing successfully");
          console.log("[remoteStream] Video paused:", remoteVideoRef.current?.paused);
        }}
        className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
      >
        Start Remote Stream ({consumers.length} available)
      </button>
    </div>
  );
}
