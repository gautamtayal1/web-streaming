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

  console.log("Creating mediasoup worker...");
  const mediaWorker = await mediasoup.createWorker({
    rtcMinPort: 20000,
    rtcMaxPort: 20200,
    logLevel: "warn",
    logTags: ["ice", "dtls", "rtp"]
  });
  console.log("Mediasoup worker created.");

  console.log("Creating WebRTC server...");
  const webRtcServer = await mediaWorker.createWebRtcServer({
    listenInfos: [
      { 
        protocol: "udp", 
        ip: "0.0.0.0"
        // announcedAddress: "88.12.10.41" // Add for production
      },
      { 
        protocol: "tcp", 
        ip: "0.0.0.0"
        // announcedAddress: "88.12.10.41" // Add for production
      }
    ]
  });
  console.log("WebRTC server created.");

  console.log("Creating mediasoup router...");
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
  console.log("Mediasoup router created.");

  wss.on("connection", (socket) => {
    const peerId = crypto.randomUUID();
    console.log(`[${peerId}] New WebSocket connection`);
    peers.set(peerId, { socket: socket as unknown as WebSocket, producers: [], consumers: []});

    socket.send(JSON.stringify({
      type: "routerRtpCapabilities",
      data: mediaRouter.rtpCapabilities,
    }));
    console.log(`[${peerId}] Sent routerRtpCapabilities`);

    // Notify new peer about existing producers
    for (const [otherPeerId, otherPeer] of peers) {
      if (otherPeerId === peerId) continue;
      for (const producer of otherPeer.producers) {
        console.log(`[${peerId}] Notifying about existing producer ${producer.id} from peer ${otherPeerId}`);
        socket.send(JSON.stringify({
          type: "newProducer",
          data: { producerId: producer.id, kind: producer.kind }
        }));
      }
    }

    socket.on("message", async (msgRaw) => {
      console.log(`[${peerId}] Received message:`, msgRaw.toString());
      const msg = JSON.parse(msgRaw.toString());
      const state = peers.get(peerId);
      
      if (!state) {
        console.error(`[${peerId}] Peer state not found for peerId:`, peerId);
        return;
      }

      switch (msg.type) {
        case "createSendTransport":
          {
            console.log(`[${peerId}] Creating send transport...`);
            const transport = await mediaRouter.createWebRtcTransport({
              webRtcServer: webRtcServer,
              enableUdp: true,
              enableTcp: false,
            });
            state.sendTransport = transport;
            console.log(`[${peerId}] Send transport created:`, transport.id);

            socket.send(JSON.stringify({
              type: "sendTransportCreated",
              data: {
                id: transport.id,
                iceParameters    : transport.iceParameters,
                iceCandidates    : transport.iceCandidates,
                dtlsParameters   : transport.dtlsParameters
              }
            }));
            console.log(`[${peerId}] Sent sendTransportCreated`);
          }
          break;

        case "connectSendTransport":
          {
            if (!state.sendTransport) {
              console.error(`[${peerId}] Send transport not found for peerId:`, peerId);
              return;
            }
            console.log(`[${peerId}] Connecting send transport...`);
            await state.sendTransport.connect({ dtlsParameters: msg.data });
            console.log(`[${peerId}] Send transport connected`);
          }
          break;

        case "produce":
          {
            if (!state.sendTransport) {
              console.error(`[${peerId}] Send transport not found for peerId:`, peerId);
              return;
            }
            const { kind, rtpParameters } = msg.data;
            console.log(`[${peerId}] Producing kind=${kind}...`);
            const producer = await state.sendTransport.produce({ kind, rtpParameters });
            state.producers.push(producer);
            console.log(`[${peerId}] Producer created:`, producer.id);

            socket.send(JSON.stringify({
              type: "produced",
              data: { producerId: producer.id }
            }));
            console.log(`[${peerId}] Sent produced`);

            for (const [otherPeerId, peer] of peers) {
              if (otherPeerId === peerId) continue;
              console.log(`[${peerId}] Notifying peer ${otherPeerId} of new producer ${producer.id}`);
              peer.socket.send(JSON.stringify({
                type: "newProducer",
                data: { producerId: producer.id, kind }
              }));
            }
          }
          break;

        case "createRecvTransport":
          {
            console.log(`[${peerId}] Creating recv transport...`);
            const transport = await mediaRouter.createWebRtcTransport({
              webRtcServer,
              enableUdp: true,
              enableTcp: true,
              preferUdp: true
            });
            state.recvTransport = transport;
            console.log(`[${peerId}] Recv transport created:`, transport.id);

            socket.send(JSON.stringify({
              type: "recvTransportCreated",
              data: {
                id             : transport.id,
                iceParameters  : transport.iceParameters,
                iceCandidates  : transport.iceCandidates,
                dtlsParameters : transport.dtlsParameters
              }
            }));
            console.log(`[${peerId}] Sent recvTransportCreated`);
          }
          break;

        case "connectRecvTransport":
          {
            if (!state.recvTransport) {
              console.error(`[${peerId}] Receive transport not found for peerId:`, peerId);
              return;
            }
            console.log(`[${peerId}] Connecting recv transport...`);
            await state.recvTransport.connect({ dtlsParameters: msg.data });
            console.log(`[${peerId}] Recv transport connected`);
          }
          break;

        case "consume":
          {
            if (!state.recvTransport) {
              console.error(`[${peerId}] Receive transport not found for peerId:`, peerId);
              return;
            }
            const { producerId, rtpCapabilities } = msg.data;
            console.log(`[${peerId}] Attempting to consume producer ${producerId}...`);
            if (!mediaRouter.canConsume({ producerId, rtpCapabilities })) {
              console.warn(`[${peerId}] Cannot consume producer ${producerId} with given rtpCapabilities`);
              socket.send(JSON.stringify({ type: "cannotConsume" }));
              break;
            }
            const consumer = await state.recvTransport.consume({
              producerId,
              rtpCapabilities,
              paused: false
            });
            state.consumers.push(consumer);
            console.log(`[${peerId}] Consumer created:`, consumer.id);

            socket.send(JSON.stringify({
              type: "consumed",
              data: {
                producerId,
                id: consumer.id,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters
              }
            }));
            console.log(`[${peerId}] Sent consumed`);
          }
          break;
        default:
          console.warn(`[${peerId}] Unknown message type:`, msg.type);
      }
    });

    socket.on("close", () => {
      console.log(`[${peerId}] WebSocket closed, cleaning up peer`);
      peers.delete(peerId);
    });
  });

  httpServer.listen(8080, () =>
    console.log("Signaling + MediaSoup server up on ws://localhost:8080")
  );
}

startServer().catch(console.error);