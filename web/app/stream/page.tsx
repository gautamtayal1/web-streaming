"use client";
import React, { useEffect, useRef, useState } from "react";
import * as mediasoupClient from "mediasoup-client";
import { useSignalSocket, WSMessage } from "@/hooks/useSignalSocket";

export default function StreamPage() {
  const localVideoRef  = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [device, setDevice] = useState<mediasoupClient.Device>();
  const [rtpCaps, setRtpCaps] = useState<mediasoupClient.types.RtpCapabilities>();
  const [sendTransport, setSendTransport] = useState<mediasoupClient.types.Transport>();
  const [recvTransport, setRecvTransport] = useState<mediasoupClient.types.Transport>();
  const [consumer, setConsumer] = useState<mediasoupClient.types.Consumer>();

  const { send } = useSignalSocket((msg: WSMessage) => {
    switch (msg.type) {
      case "routerRtpCapabilities":
        {
          (async () => {
            try {
              const dev = new mediasoupClient.Device();
              await dev.load({ routerRtpCapabilities: msg.data });
              setDevice(dev);
              setRtpCaps(msg.data);

              // ask backend to create transports
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
          if (!device) return;
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
              send({ type: "produce", data: { kind, rtpParameters } });
              callback({ id: "" }); // id is not used on client side
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
          if (!device) return;
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
          // someone else started producing — consume it
          send({ type: "consume", data: { 
            producerId: msg.data.producerId, 
            rtpCapabilities: rtpCaps 
          }});
        }
        break;

      case "consumed":
        {
          (async () => {
            try {
              const { id, producerId, kind, rtpParameters } = msg.data;
              if (!recvTransport) return;
              const consumer = await recvTransport.consume({ id, producerId, kind, rtpParameters});
              setConsumer(consumer);
              // attach track to remote video
              const stream = new MediaStream([consumer.track]);
              if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = stream;
              }
            } catch (error) {
              console.error("Failed to consume:", error);
            }
          })();
        }
        break;
    }
  });

  // once transport exists and local preview ready, produce
  useEffect(() => {
    if (!sendTransport || !localVideoRef.current) return;
    const stream = localVideoRef.current.srcObject as MediaStream;
    if (!stream) return;
    
    (async () => {
      try {
        const tracks = stream.getTracks();
        for (const track of tracks) {
          await sendTransport.produce({ track });
        }
      } catch (error) {
        console.error("Failed to produce:", error);
      }
    })();
  }, [sendTransport]);

  // initial getUserMedia
  useEffect(() => {
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
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
      <div className="flex gap-4">
        <div>
          <h2>Your Video</h2>
          <video ref={localVideoRef} autoPlay muted playsInline className="w-64"/>
        </div>
        <div>
          <h2>Peer Video</h2>
          <video ref={remoteVideoRef} autoPlay playsInline className="w-64"/>
        </div>
      </div>
    </div>
  );
}
