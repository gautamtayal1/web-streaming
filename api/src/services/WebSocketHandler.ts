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
    const producer = await peer.sendTransport.produce({ kind, rtpParameters });
    
    if (producer.paused) {
      await producer.resume();
    }
    
    peer.producers.push(producer);
    
    // Start FFmpeg if this is the first producer (like reference)
    await this.streamingService.startFFmpegForProducer(producer);
    
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