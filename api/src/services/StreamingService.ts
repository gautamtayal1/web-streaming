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
    console.log(`[streaming] Starting FFmpeg for producer ${producer.id} (${producer.kind})`);
    
    // Initialize FFmpeg infrastructure if not already done
    if (!this.videoTransport || !this.audioTransport) {
      console.log('[streaming] Initializing FFmpeg infrastructure...');
      await this.initializeFFmpeg();
    } else {
      console.log('[streaming] FFmpeg infrastructure already initialized');
    }
    
    // Pipe this specific producer to RTP for FFmpeg consumption
    console.log(`[streaming] Piping producer ${producer.id} to RTP...`);
    await this.pipeProducerToRtp(producer);
    console.log(`[streaming] Producer ${producer.id} successfully piped to FFmpeg`);
  }

  private async initializeFFmpeg(): Promise<void> {
    const router = this.mediaSoupService.getRouter();
    
    // Create video transport - MediaSoup will send RTP TO FFmpeg
    this.videoTransport = await router.createPlainTransport({
      listenIp: { ip: "127.0.0.1", announcedIp: undefined },
      rtcpMux: false,
      comedia: false // We'll tell MediaSoup where to send RTP
    });
    
    // Create audio transport
    this.audioTransport = await router.createPlainTransport({
      listenIp: { ip: "127.0.0.1", announcedIp: undefined },
      rtcpMux: false,
      comedia: false
    });

    console.log('[streaming] PlainTransports created');
    console.log(`[streaming] Video transport listening on: ${this.videoTransport.tuple.localIp}:${this.videoTransport.tuple.localPort}`);
    console.log(`[streaming] Audio transport listening on: ${this.audioTransport.tuple.localIp}:${this.audioTransport.tuple.localPort}`);

    // Connect transports to send RTP to FFmpeg
    await this.videoTransport.connect({ ip: '127.0.0.1', port: 5004, rtcpPort: 5005 });
    await this.audioTransport.connect({ ip: '127.0.0.1', port: 5006, rtcpPort: 5007 });

    console.log('[streaming] PlainTransports connected, waiting for producers...');
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
    
    // Log detailed RTP parameters for debugging
    console.log(`[streaming] Consumer created for ${producer.kind}:`);
    console.log(`[streaming]   Codec: ${rtpConsumer.rtpParameters.codecs[0]?.mimeType}`);
    console.log(`[streaming]   Payload Type: ${rtpConsumer.rtpParameters.codecs[0]?.payloadType}`);
    console.log(`[streaming]   Clock Rate: ${rtpConsumer.rtpParameters.codecs[0]?.clockRate}`);
    if (producer.kind === 'audio') {
      console.log(`[streaming]   Channels: ${rtpConsumer.rtpParameters.codecs[0]?.channels}`);
    }
    
    this.rtpConsumers.set(producer.id, rtpConsumer);
    console.log(`[streaming] Producer ${producer.id} (${producer.kind}) piped to RTP transport`);
    
    // Check conditions for starting FFmpeg
    const ffmpegRunning = this.ffmpegService.isRunning();
    const hasConsumers = this.hasVideoAndAudioConsumers();
    console.log(`[streaming] FFmpeg status: running=${ffmpegRunning}, hasConsumers=${hasConsumers}`);
    
    // Start FFmpeg only when we have both video and audio consumers
    if (!ffmpegRunning && hasConsumers) {
      console.log('[streaming] Starting FFmpeg to consume RTP streams...');
      
      // Collect RTP parameters for all consumers to pass to FFmpeg
      const rtpParams = this.collectRtpParameters();
      this.ffmpegService.startFFmpegWithParams(5004, 5006, rtpParams);
    } else if (ffmpegRunning) {
      console.log('[streaming] FFmpeg already running, not starting again');
    } else {
      console.log('[streaming] Waiting for both video and audio consumers before starting FFmpeg');
    }
  }

  async stopFFmpegIfNoProducers(): Promise<void> {
    const producerCount = this.getAllProducers().length;
    console.log(`[streaming] Checking producers: ${producerCount} active`);
    
    if (producerCount === 0) {
      console.log('[streaming] No producers left, stopping FFmpeg and cleaning up...');
      this.ffmpegService.stopFFmpeg();
      
      console.log(`[streaming] Closing ${this.rtpConsumers.size} RTP consumers`);
      this.rtpConsumers.forEach(consumer => consumer.close());
      this.rtpConsumers.clear();
      
      if (this.videoTransport || this.audioTransport) {
        console.log('[streaming] Closing PlainTransports');
        this.videoTransport?.close();
        this.audioTransport?.close();
        this.videoTransport = null;
        this.audioTransport = null;
      }
      
      console.log('[streaming] ✅ FFmpeg cleanup completed');
    } else {
      console.log(`[streaming] Still have ${producerCount} producers, keeping FFmpeg running`);
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

  private hasVideoAndAudioConsumers(): boolean {
    let hasVideo = false;
    let hasAudio = false;
    
    for (const consumer of this.rtpConsumers.values()) {
      if (consumer.kind === 'video') hasVideo = true;
      if (consumer.kind === 'audio') hasAudio = true;
    }
    
    console.log(`[streaming] Consumer check: video=${hasVideo}, audio=${hasAudio}`);
    return hasVideo && hasAudio;
  }

  private collectRtpParameters() {
    const rtpParams: { video?: any, audio?: any } = {};
    
    for (const consumer of this.rtpConsumers.values()) {
      const codec = consumer.rtpParameters.codecs[0];
      if (consumer.kind === 'video') {
        rtpParams.video = {
          mimeType: codec.mimeType,
          payloadType: codec.payloadType,
          clockRate: codec.clockRate
        };
      } else if (consumer.kind === 'audio') {
        rtpParams.audio = {
          mimeType: codec.mimeType,
          payloadType: codec.payloadType,
          clockRate: codec.clockRate,
          channels: codec.channels
        };
      }
    }
    
    return rtpParams;
  }

  // Legacy methods for compatibility
  async createFFmpegStream(streamId: string): Promise<FFmpegStream> {
    throw new Error("Use startFFmpegForProducer instead");
  }

  cleanupFFmpegStreams(): void {
    this.stopFFmpegIfNoProducers();
  }

  getActiveStreams() {
    const hasActiveProducers = this.getAllProducers().length > 0;
    return hasActiveProducers && this.ffmpegService.isRunning() ? [{ streamId: "main", hlsUrl: "/hls/stream.m3u8" }] : [];
  }
}