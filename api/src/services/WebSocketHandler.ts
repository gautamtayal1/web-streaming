import { Peer } from "../utils/types";
import { MediaSoupService } from "./MediaSoupService";

export class WebSocketHandler {
  constructor(
    private mediaSoupService: MediaSoupService,
    private peers: Map<string, Peer>,
    private streamingService: any
  ) {}

  async handleMessage(msg: any, peer: Peer, socket: any, peerId: string): Promise<void> {
    switch (msg.type) {
      case "createSendTransport":
        await this.handleCreateSendTransport(peer, socket);
        break;
      case "connectSendTransport":
        await this.handleConnectSendTransport(peer, msg.data);
        break;
      case "produce":
        await this.handleProduce(peer, socket, msg.data, peerId);
        break;
      case "createRecvTransport":
        await this.handleCreateRecvTransport(peer, socket);
        break;
      case "connectRecvTransport":
        await this.handleConnectRecvTransport(peer, msg.data);
        break;
      case "consume":
        await this.handleConsume(peer, socket, msg.data);
        break;
    }
  }

  private async handleCreateSendTransport(peer: Peer, socket: any): Promise<void> {
    const transport = await this.mediaSoupService.createWebRtcTransport();
    peer.sendTransport = transport;
    
    socket.send(JSON.stringify({
      type: "sendTransportCreated",
      data: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      }
    }));
  }

  private async handleConnectSendTransport(peer: Peer, dtlsParameters: any): Promise<void> {
    if (peer.sendTransport) {
      await peer.sendTransport.connect({ dtlsParameters });
    }
  }

  private async handleProduce(peer: Peer, socket: any, data: any, peerId: string): Promise<void> {
    if (!peer.sendTransport) return;
    
    const { kind, rtpParameters } = data;
    console.log(`[websocket] 🎥 Creating ${kind} producer for peer ${peerId}`);
    console.log(`[websocket] RTP parameters:`, {
      codecs: rtpParameters.codecs?.map((c: any) => ({ mimeType: c.mimeType, payloadType: c.payloadType })),
      encodings: rtpParameters.encodings?.length || 0
    });
    
    const producer = await peer.sendTransport.produce({ kind, rtpParameters });
    
    console.log(`[websocket] Producer created with state: paused=${producer.paused}, closed=${producer.closed}`);
    
    if (producer.paused) {
      await producer.resume();
      console.log(`[websocket] Producer ${producer.id} resumed successfully`);
    } else {
      console.log(`[websocket] Producer ${producer.id} was not paused, should be producing immediately`);
    }

    // Ensure producer is active and request keyframe immediately
    await producer.resume();
    console.log(`[websocket] Force resumed producer ${producer.id}, final state: paused=${producer.paused}`);

    // Note: Keyframes are requested on the consumer side, not producer side

    // Log RTP parameters to check codec configuration
    console.log(`[websocket] Producer RTP parameters:`, {
      codecs: producer.rtpParameters.codecs.map(c => ({ 
        mimeType: c.mimeType, 
        payloadType: c.payloadType,
        clockRate: c.clockRate 
      })),
      encodings: producer.rtpParameters.encodings
    });
    
    peer.producers.push(producer);
    console.log(`[websocket] ✅ Producer created: ${producer.id} (${kind})`);
    
    producer.on('score', (score) => {
      console.log(`[websocket] Producer ${producer.id} score update:`, score);
    });
    
    // Start FFmpeg if this is the first producer (like reference)
    try {
      console.log(`[websocket] 🚀 Calling streamingService.startFFmpegForProducer...`);
      await this.streamingService.startFFmpegForProducer(producer, peerId);
      console.log(`[websocket] ✅ FFmpeg process initiated for producer ${producer.id}`);
    } catch (error) {
      console.error(`[websocket] ❌ Failed to start FFmpeg for producer ${producer.id}:`, error);
    }
    
    socket.send(JSON.stringify({
      type: "produced",
      data: { producerId: producer.id }
    }));

    this.notifyOtherPeersOfNewProducer(peerId, producer.id, kind);
  }

  private async handleCreateRecvTransport(peer: Peer, socket: any): Promise<void> {
    const transport = await this.mediaSoupService.createWebRtcTransport();
    peer.recvTransport = transport;
    
    socket.send(JSON.stringify({
      type: "recvTransportCreated",
      data: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      }
    }));
  }

  private async handleConnectRecvTransport(peer: Peer, dtlsParameters: any): Promise<void> {
    if (peer.recvTransport) {
      await peer.recvTransport.connect({ dtlsParameters });
    }
  }

  private async handleConsume(peer: Peer, socket: any, data: any): Promise<void> {
    if (!peer.recvTransport) return;
    
    const { producerId, rtpCapabilities } = data;
    const router = this.mediaSoupService.getRouter();
    
    if (!router.canConsume({ producerId, rtpCapabilities })) {
      socket.send(JSON.stringify({ type: "cannotConsume" }));
      return;
    }
    
    const consumer = await peer.recvTransport.consume({
      producerId,
      rtpCapabilities,
      paused: true
    });
    
    await consumer.resume();
    peer.consumers.push(consumer);
    
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

  private notifyOtherPeersOfNewProducer(peerId: string, producerId: string, kind: string): void {
    for (const [otherPeerId, otherPeer] of this.peers) {
      if (otherPeerId === peerId) continue;
      otherPeer.socket.send(JSON.stringify({
        type: "newProducer",
        data: { producerId, kind }
      }));
    }
  }

  notifyExistingProducers(socket: any, peerId: string): void {
    for (const [otherPeerId, otherPeer] of this.peers) {
      if (otherPeerId === peerId) continue;
      for (const producer of otherPeer.producers) {
        socket.send(JSON.stringify({
          type: "newProducer",
          data: { producerId: producer.id, kind: producer.kind }
        }));
      }
    }
  }
}