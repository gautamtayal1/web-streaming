import { FFmpegStream, Peer } from "../utils/types";
import { MediaSoupService } from "./MediaSoupService";
import { FFmpegService } from "./FFmpegService";
import * as mediasoup from "mediasoup";

export class StreamingService {
  private producerAssignments = new Map<string, number>();

  constructor(
    private mediaSoupService: MediaSoupService,
    private ffmpegService: FFmpegService,
    private peers: Map<string, Peer>,
    private ffmpegStreams: Map<string, FFmpegStream>
  ) {}

  async startFFmpegForProducer(producer: mediasoup.types.Producer, peerId: string): Promise<void> {
    const transportIndex = this.getProducerTransportIndex(peerId);
    if (transportIndex === -1) {
      console.error(`Invalid peer index for peer ${peerId}`);
      return;
    }

    this.producerAssignments.set(producer.id, transportIndex);
    await this.mediaSoupService.createRtpConsumer(producer, transportIndex);
    
    if (!this.ffmpegService.isRunning()) {
      await this.ffmpegService.startWithStaticSDP();
    }
  }

  private getProducerTransportIndex(peerId: string): number {
    const peerIds = Array.from(this.peers.keys());
    const peerIndex = peerIds.indexOf(peerId);
    return peerIndex > 1 ? -1 : peerIndex;
  }

  async cleanupProducer(producerId: string): Promise<void> {
    this.producerAssignments.delete(producerId);
  }

  async stopFFmpegIfNoProducers(): Promise<void> {
    if (this.getAllProducers().length === 0) {
      this.ffmpegService.stopFFmpeg();
      this.producerAssignments.clear();
    }
  }

  private getAllProducers(): mediasoup.types.Producer[] {
    const allProducers = [];
    for (const peer of this.peers.values()) {
      allProducers.push(...peer.producers);
    }
    return allProducers;
  }

  cleanupFFmpegStreams(): void {
    this.stopFFmpegIfNoProducers();
  }

}