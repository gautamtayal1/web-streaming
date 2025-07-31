import { FFmpegStream, Peer } from "../utils/types";
import { MediaSoupService } from "./MediaSoupService";
import { FFmpegService } from "./FFmpegService";
import * as mediasoup from "mediasoup";

export class StreamingService {
  private videoTransport: mediasoup.types.PlainTransport | null = null;
  private audioTransport: mediasoup.types.PlainTransport | null = null;
  private rtpConsumers = new Map<string, mediasoup.types.Consumer>();

  constructor(
    private mediaSoupService: MediaSoupService,
    private ffmpegService: FFmpegService,
    private peers: Map<string, Peer>,
    private ffmpegStreams: Map<string, FFmpegStream>
  ) {}

  async startFFmpegForProducer(producer: mediasoup.types.Producer): Promise<void> {
    if (!this.ffmpegService.isRunning()) {
      await this.initializeFFmpeg();
    }
    await this.pipeProducerToRtp(producer);
  }

  private async initializeFFmpeg(): Promise<void> {
    const router = this.mediaSoupService.getRouter();
    
    // Create video transport
    this.videoTransport = await router.createPlainTransport({
      listenIp: { ip: "127.0.0.1", announcedIp: undefined },
      rtcpMux: false,
      comedia: false
    });
    await this.videoTransport.connect({ ip: '127.0.0.1', port: 5004, rtcpPort: 5005 });
    
    // Create audio transport  
    this.audioTransport = await router.createPlainTransport({
      listenIp: { ip: "127.0.0.1", announcedIp: undefined },
      rtcpMux: false,
      comedia: false
    });
    await this.audioTransport.connect({ ip: '127.0.0.1', port: 5006, rtcpPort: 5007 });

    // Start FFmpeg with the transport ports
    this.ffmpegService.startFFmpeg(
      this.videoTransport.tuple.localPort,
      this.audioTransport.tuple.localPort
    );

    console.log('[streaming] FFmpeg initialized');
  }

  private async pipeProducerToRtp(producer: mediasoup.types.Producer): Promise<void> {
    const transport = producer.kind === 'video' ? this.videoTransport : this.audioTransport;
    if (!transport) return;

    const router = this.mediaSoupService.getRouter();
    const rtpConsumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities: router.rtpCapabilities,
      paused: false,
    });
    
    this.rtpConsumers.set(producer.id, rtpConsumer);
    console.log(`[streaming] Producer ${producer.id} (${producer.kind}) piped to FFmpeg`);
  }

  async stopFFmpegIfNoProducers(): Promise<void> {
    if (this.getAllProducers().length === 0) {
      console.log('[streaming] No producers left, stopping FFmpeg');
      this.ffmpegService.stopFFmpeg();
      
      this.rtpConsumers.forEach(consumer => consumer.close());
      this.rtpConsumers.clear();
      
      this.videoTransport?.close();
      this.audioTransport?.close();
      this.videoTransport = null;
      this.audioTransport = null;
    }
  }

  cleanupProducer(producerId: string): void {
    const consumer = this.rtpConsumers.get(producerId);
    if (consumer) {
      consumer.close();
      this.rtpConsumers.delete(producerId);
    }
  }

  private getAllProducers(): mediasoup.types.Producer[] {
    const allProducers = [];
    for (const peer of this.peers.values()) {
      allProducers.push(...peer.producers);
    }
    return allProducers;
  }

  // Legacy methods for compatibility
  async createFFmpegStream(streamId: string): Promise<FFmpegStream> {
    throw new Error("Use startFFmpegForProducer instead");
  }

  cleanupFFmpegStreams(): void {
    this.stopFFmpegIfNoProducers();
  }

  getActiveStreams() {
    return this.ffmpegService.isRunning() ? [{ streamId: "main", hlsUrl: "/hls/stream.m3u8" }] : [];
  }
}