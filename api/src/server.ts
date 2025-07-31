import http from "http";
import { WebSocketServer } from "ws";
import * as mediasoup from "mediasoup";

interface Peer {
  socket: WebSocket;
  sendTransport?: mediasoup.types.WebRtcTransport;
  recvTransport?: mediasoup.types.WebRtcTransport;
  producers: mediasoup.types.Producer[];
  consumers: mediasoup.types.Consumer[];
}

async function startServer() {
  const httpServer = http.createServer();
  const wss        = new WebSocketServer({ server: httpServer });
  const peers      = new Map<string, Peer>();

  const mediaWorker = await mediasoup.createWorker({
    rtcMinPort: 20000,
    rtcMaxPort: 20200,
    logLevel: "warn",
    logTags: ["ice", "dtls", "rtp"]
  });

  const webRtcServer = await mediaWorker.createWebRtcServer({
    listenInfos: [
      { 
        protocol: "udp", 
        ip: "127.0.0.1",
        port: 20000,
      },
      { 
        protocol: "tcp", 
        ip: "127.0.0.1",
        port: 20001,
      }
    ]
  });

  const mediaRouter = await mediaWorker.createRouter({
    mediaCodecs: [
      {
        kind       : "audio",
        mimeType   : "audio/opus",
        clockRate  : 48000,
        channels   : 2
      },
      {
        kind       : "video",
        mimeType   : "video/VP8",
        clockRate  : 90000,
        parameters : {},
        rtcpFeedback: [
          { type: "nack" },
          { type: "nack", parameter: "pli" },
          { type: "ccm", parameter: "fir" },
          { type: "goog-remb" }
        ]
      },
      {
        kind       : "video",
        mimeType   : "video/H264",
        clockRate  : 90000,
        parameters :
        {
          "packetization-mode"      : 1,
          "profile-level-id"        : "42e01f",
          "level-asymmetry-allowed" : 1
        }
      }
    ]
  });

  wss.on("connection", (socket) => {
    const peerId = crypto.randomUUID();
    peers.set(peerId, { socket: socket as unknown as WebSocket, producers: [], consumers: []});

    socket.send(JSON.stringify({
      type: "routerRtpCapabilities",
      data: mediaRouter.rtpCapabilities,
    }));

    for (const [otherPeerId, otherPeer] of peers) {
      if (otherPeerId === peerId) continue;
      for (const producer of otherPeer.producers) {
        socket.send(JSON.stringify({
          type: "newProducer",
          data: { producerId: producer.id, kind: producer.kind }
        }));
      }
    }

    socket.on("message", async (msgRaw) => {
      const msg = JSON.parse(msgRaw.toString());
      const state = peers.get(peerId);
      
      if (!state) {
        return;
      }

      switch (msg.type) {
        case "createSendTransport":
          {
            const transport = await mediaRouter.createWebRtcTransport({
              webRtcServer: webRtcServer,
              enableUdp: true,
              enableTcp: true,
              preferUdp: true
            });
            state.sendTransport = transport;

            socket.send(JSON.stringify({
              type: "sendTransportCreated",
              data: {
                id: transport.id,
                iceParameters    : transport.iceParameters,
                iceCandidates    : transport.iceCandidates,
                dtlsParameters   : transport.dtlsParameters
              }
            }));
          }
          break;

        case "connectSendTransport":
          {
            if (!state.sendTransport) {
              return;
            }
            await state.sendTransport.connect({ dtlsParameters: msg.data });
          }
          break;

        case "produce":
          {
            if (!state.sendTransport) {
              return;
            }
            const { kind, rtpParameters } = msg.data;
            const producer = await state.sendTransport.produce({ kind, rtpParameters });
            
            if (producer.paused) {
              await producer.resume();
            }
            
            state.producers.push(producer);

            socket.send(JSON.stringify({
              type: "produced",
              data: { producerId: producer.id }
            }));

            for (const [otherPeerId, peer] of peers) {
              if (otherPeerId === peerId) continue;
              peer.socket.send(JSON.stringify({
                type: "newProducer",
                data: { producerId: producer.id, kind }
              }));
            }
          }
          break;

        case "createRecvTransport":
          {
            const transport = await mediaRouter.createWebRtcTransport({
              webRtcServer,
              enableUdp: true,
              enableTcp: true,
              preferUdp: true
            });
            state.recvTransport = transport;

            socket.send(JSON.stringify({
              type: "recvTransportCreated",
              data: {
                id             : transport.id,
                iceParameters  : transport.iceParameters,
                iceCandidates  : transport.iceCandidates,
                dtlsParameters : transport.dtlsParameters
              }
            }));
          }
          break;

        case "connectRecvTransport":
          {
            if (!state.recvTransport) {
              return;
            }
            await state.recvTransport.connect({ dtlsParameters: msg.data });
          }
          break;

        case "consume":
          {
            if (!state.recvTransport) {
              return;
            }
            const { producerId, rtpCapabilities } = msg.data;
            if (!mediaRouter.canConsume({ producerId, rtpCapabilities })) {
              socket.send(JSON.stringify({ type: "cannotConsume" }));
              break;
            }
            const consumer = await state.recvTransport.consume({
              producerId,
              rtpCapabilities,
              paused: true
            });
            
            await consumer.resume();
            state.consumers.push(consumer);

            socket.send(JSON.stringify({
              type: "consumed",
              data: {
                producerId,
                id: consumer.id,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters
              }
            }));
          }
          break;
        default:
          break;
      }
    });

    socket.on("close", () => {
      peers.delete(peerId);
    });
  });

  httpServer.listen(8080, () =>
    console.log("Server running on ws://localhost:8080")
  );
}

startServer().catch(console.error);