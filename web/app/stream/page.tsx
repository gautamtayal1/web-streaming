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
        break;

      case "sendTransportCreated":
        {
          if (!device) return;
          const transport = device.createSendTransport(msg.data);
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
          if (!device) return;
          const transport = device.createRecvTransport(msg.data);
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
        if (recvTransport && rtpCaps) {
          send({ type: "consume", data: { 
            producerId: msg.data.producerId, 
            rtpCapabilities: rtpCaps 
          }});
        } else {
          setPendingProducers(prev => [...prev, msg.data.producerId]);
        }
        break;

      case "consumed":
        (async () => {
          try {
            if (!recvTransport) return;
            const consumer = await recvTransport.consume(msg.data);
            consumer.resume();
            setConsumers(prev => [...prev, consumer]);
          } catch (error) {
            console.error("Failed to consume:", error);
          }
        })();
        break;

      case "produced":
        const callback = pendingProduceCallbacksRef.current.shift();
        if (callback) callback({ id: msg.data.producerId });
        break;

      default:
        break;
    }
  }, [device, rtpCaps, recvTransport]);

  const { connected, send } = useSignalSocket(onMessage);

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
    
    localStream.getTracks().forEach(async (track) => {
      try {
        await sendTransport.produce({ track });
      } catch (error) {
        console.error(`Failed to produce ${track.kind} track:`, error);
      }
    });
  }, [sendTransport, localStream]);

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      })
      .catch(error => console.error("Failed to get user media:", error));
  }, []);


  return (
    <div className="min-h-screen flex flex-col justify-center items-center bg-black p-4">
      <div className="w-[90vw] h-[90vh] flex gap-4 justify-center items-center">
        <div className="flex-1 h-full flex flex-col">
          <h2 className="text-white text-center mb-2 text-lg font-semibold">Your Video</h2>
          <video 
            ref={localVideoRef} 
            autoPlay 
            muted 
            playsInline 
            className="w-full h-full border-2 border-blue-500 bg-gray-800 object-cover rounded-lg"
          />
        </div>
        <div className="flex-1 h-full flex flex-col">
          <h2 className="text-white text-center mb-2 text-lg font-semibold">Peer Video</h2>
          <video 
            ref={remoteVideoRef} 
            autoPlay 
            playsInline 
            className="w-full h-full border-2 border-red-500 bg-gray-800 object-cover rounded-lg" 
          />
        </div>
      </div>
    </div>
  );
}