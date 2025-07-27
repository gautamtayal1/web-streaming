import http from "http";
import { WebSocketServer } from "ws";
import * as mediasoup from "mediasoup";

interface Peer {
  socket: WebSocket;
  sendTransport?: mediasoup.types.WebRtcTransport;
  recvTransport?: mediasoup.types.WebRtcTransport;
  producer?: mediasoup.types.Producer;
  consumer?: mediasoup.types.Consumer;
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
        parameters : {}
      }
    ]
  });

  wss.on("connection", (socket) => {
    const peerId = crypto.randomUUID();
    peers.set(peerId, { socket: socket as unknown as WebSocket});

    socket.send(JSON.stringify({
      type: "routerRtpCapabilities",
      data: mediaRouter.rtpCapabilities,
    }));

    socket.on("message", async (msgRaw) => {
      const msg = JSON.parse(msgRaw.toString());
      const state = peers.get(peerId);
      
      if (!state) {
        console.error("Peer state not found for peerId:", peerId);
        return;
      }

      switch (msg.type) {
        case "createSendTransport":
          {
            const transport = await mediaRouter.createWebRtcTransport({
              listenInfos: [{ protocol: "udp", ip: "0.0.0.0" }],
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
              console.error("Send transport not found for peerId:", peerId);
              return;
            }
            await state.sendTransport.connect({ dtlsParameters: msg.data });
          }
          break;

        case "produce":
          {
            if (!state.sendTransport) {
              console.error("Send transport not found for peerId:", peerId);
              return;
            }
            const { kind, rtpParameters } = msg.data;
            const producer = await state.sendTransport.produce({ kind, rtpParameters });
            state.producer = producer;

            socket.send(JSON.stringify({
              type: "produced",
              data: { producerId: producer.id }
            }));

            for (const [peerId, peer] of peers) {
              if (peerId === peerId) continue;
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
              listenInfos: [{ protocol: "udp", ip: "0.0.0.0" }],
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
              console.error("Receive transport not found for peerId:", peerId);
              return;
            }
            await state.recvTransport.connect({ dtlsParameters: msg.data });
          }
          break;

        case "consume":
          {
            if (!state.recvTransport) {
              console.error("Receive transport not found for peerId:", peerId);
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
              paused: false
            });
            state.consumer = consumer;

            socket.send(JSON.stringify({
              type: "consumed",
              data: {
                producerId,
                id             : consumer.id,
                kind           : consumer.kind,
                rtpParameters  : consumer.rtpParameters
              }
            }));
          }
          break;
      }
    });

    socket.on("close", () => {
      peers.delete(peerId);
    });
  });

  httpServer.listen(8080, () =>
    console.log("Signaling + MediaSoup server up on ws://localhost:8080")
  );
}

startServer().catch(console.error);