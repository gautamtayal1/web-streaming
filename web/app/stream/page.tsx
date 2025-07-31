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
          if (!device) {
            return;
          }
          const transport = device.createSendTransport({ id, iceParameters, iceCandidates, dtlsParameters });

          transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
            try {
              send({ type: "connectSendTransport", data: dtlsParameters });
              callback();
            } catch (error) {
              errback(error as Error);
            }
          });
          transport.on("produce", async ({ kind, rtpParameters }, callback, errback) => {
            try {
              pendingProduceCallbacksRef.current.push(callback);
              send({ type: "produce", data: { kind, rtpParameters } });
            } catch (error) {
              errback(error as Error);
            }
          });
          setSendTransport(transport);
        }
        break;

      case "recvTransportCreated":
        {
          const { id, iceParameters, iceCandidates, dtlsParameters } = msg.data;
          if (!device) {
            return;
          }
          const transport = device.createRecvTransport({ id, iceParameters, iceCandidates, dtlsParameters });

          transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
            try {
              send({ type: "connectRecvTransport", data: dtlsParameters });
              callback();
            } catch (error) {
              errback(error as Error);
            }
          });
          setRecvTransport(transport);
        }
        break;

      case "newProducer":
        {
          if (recvTransport && rtpCaps) {
            send({ type: "consume", data: { 
              producerId: msg.data.producerId, 
              rtpCapabilities: rtpCaps 
            }});
          } else {
            setPendingProducers(prev => [...prev, msg.data.producerId]);
          }
        }
        break;

      case "consumed":
        {
          (async () => {
            try {
              const { id, producerId, kind, rtpParameters } = msg.data;
              if (!recvTransport) {
                return;
              }
              const consumer = await recvTransport.consume({ id, producerId, kind, rtpParameters});
              consumer.resume();
              setConsumers(prev => [...prev, consumer]);
            } catch (error) {
              console.error("Failed to consume:", error);
            }
          })();
        }
        break;

      case "produced":
        {
          const { producerId } = msg.data;
          if (pendingProduceCallbacksRef.current.length > 0) {
            const callback = pendingProduceCallbacksRef.current.shift()!;
            callback({ id: producerId });
          }
        }
        break;

      default:
        break;
    }
  }, [device, rtpCaps, recvTransport, send]);

  const { send } = useSignalSocket(onMessage);

  useEffect(() => {
    if (consumers.length >= 1) {
      const tracks = consumers.map(consumer => consumer.track);

      if (tracks.length === 0) {
        return;
      }
      
      const stream = new MediaStream(tracks);
      setRemoteStream(stream);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.play().catch(console.error);
      }
    }
  }, [consumers]);

  useEffect(() => {
    if (recvTransport && rtpCaps && pendingProducers.length > 0) {
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
    if (!sendTransport || !localStream) return;
    
    (async () => {
      try {
        const tracks = localStream.getTracks();
        for (const track of tracks) {
          if (!sendTransport) {
            return;
          }
          
          try {
            await sendTransport.produce({ track });
          } catch (trackError) {
            console.error(`Failed to produce ${track.kind} track:`, trackError);
          }
        }
      } catch (error) {
        console.error("Failed to produce:", error);
      }
    })();
  }, [sendTransport, localStream]);

  useEffect(() => {
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (error) {
        console.error("Failed to get user media:", error);
      }
    })();
  }, []);


  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-4 justify-center items-center">
        <div>
          <h2>Your Video</h2>
          <video 
            ref={localVideoRef} 
            autoPlay 
            muted 
            playsInline 
            className="w-150 h-150 border-4 border-blue-500 bg-gray-200 object-cover"
          />
        </div>
        <div>
          <h2>Peer Video</h2>
          <div className="relative">
            <video 
              ref={remoteVideoRef} 
              autoPlay 
              playsInline 
              className="w-150 h-150 border-4 border-red-500 object-cover" 
            />
          </div>
        </div>
      </div>
    </div>
  );
}