import { FFmpegStream, Peer } from "../utils/types";
import { MediaSoupService } from "./MediaSoupService";
import { FFmpegService } from "./FFmpegService";
import * as mediasoup from "mediasoup";

export class StreamingService {
  private streamTransports = new Map<string, { video: mediasoup.types.PlainTransport, audio: mediasoup.types.PlainTransport }>();
  private streamPorts = new Map<string, { videoPort: number, audioPort: number }>();
  private rtpConsumers = new Map<string, mediasoup.types.Consumer>();
  private producerToStreamId = new Map<string, string>();
  private nextPortPair = 5004; // Starting port pair

  constructor(
    private mediaSoupService: MediaSoupService,
    private ffmpegService: FFmpegService,
    private peers: Map<string, Peer>,
    private ffmpegStreams: Map<string, FFmpegStream>
  ) {}

  async startFFmpegForProducer(producer: mediasoup.types.Producer, peerId: string): Promise<void> {
    console.log(`[streaming] Starting FFmpeg for producer ${producer.id} (${producer.kind})`);
    
    if (!peerId) {
      console.error(`[streaming] Invalid peerId for producer ${producer.id}`);
      return;
    }

    const streamId = `stream_${peerId}`;
    this.producerToStreamId.set(producer.id, streamId);
    
    // Initialize stream infrastructure for this specific peer/stream
    await this.initializeStreamTransports(streamId);
    
    // Pipe this specific producer to RTP for FFmpeg consumption
    console.log(`[streaming] Piping producer ${producer.id} to RTP for stream ${streamId}...`);
    await this.pipeProducerToRtp(producer, streamId);
    console.log(`[streaming] Producer ${producer.id} successfully piped to stream ${streamId}`);
  }

  private async initializeStreamTransports(streamId: string): Promise<void> {
    if (this.streamTransports.has(streamId)) {
      console.log(`[streaming] Stream ${streamId} already has transports`);
      return;
    }

    const router = this.mediaSoupService.getRouter();
    const videoPort = this.nextPortPair;
    const audioPort = this.nextPortPair + 1;
    this.nextPortPair += 2; // Reserve 4 ports per stream (video + rtcp, audio + rtcp)
    
    // Create video transport - MediaSoup will send RTP TO FFmpeg
    const videoTransport = await router.createPlainTransport({
      listenInfo: { protocol: "udp", ip: "127.0.0.1" },
      rtcpMux: true,
      comedia: false,
      enableSrtp: false,
      enableSctp: false
    });
    
    // Create audio transport
    const audioTransport = await router.createPlainTransport({
      listenInfo: { protocol: "udp", ip: "127.0.0.1" },
      rtcpMux: true,
      comedia: false,
      enableSrtp: false,
      enableSctp: false
    });

    console.log(`[streaming] PlainTransports created for stream ${streamId}`);
    console.log(`[streaming] Video transport: ${videoTransport.tuple.localIp}:${videoTransport.tuple.localPort} -> FFmpeg port ${videoPort}`);
    console.log(`[streaming] Audio transport: ${audioTransport.tuple.localIp}:${audioTransport.tuple.localPort} -> FFmpeg port ${audioPort}`);

    // Connect transports to send RTP to FFmpeg
    await videoTransport.connect({ ip: '127.0.0.1', port: videoPort });
    await audioTransport.connect({ ip: '127.0.0.1', port: audioPort });

    this.streamTransports.set(streamId, { video: videoTransport, audio: audioTransport });
    this.streamPorts.set(streamId, { videoPort, audioPort });
    console.log(`[streaming] Stream ${streamId} transports connected`);
  }

  private async pipeProducerToRtp(producer: mediasoup.types.Producer, streamId: string): Promise<void> {
    const transports = this.streamTransports.get(streamId);
    if (!transports) return;

    const transport = producer.kind === 'video' ? transports.video : transports.audio;
    const router = this.mediaSoupService.getRouter();
    
    // Ensure all streams for the same ID start at synchronized timestamps
    // let startTime = this.streamStartTimes.get(streamId);
    // if (!startTime) {
    //   startTime = Date.now();
    //   this.streamStartTimes.set(streamId, startTime);
    //   console.log(`[streaming] Setting synchronized start time for stream ${streamId}: ${startTime}`);
    // }
    
    const rtpConsumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities: router.rtpCapabilities,
    });
    
    console.log(`[streaming] Consumer created for ${producer.kind} in stream ${streamId}:`);
    console.log(`[streaming] Codec: ${rtpConsumer.rtpParameters.codecs[0]?.mimeType}`);
    console.log(`[streaming] Payload Type: ${rtpConsumer.rtpParameters.codecs[0]?.payloadType}`);
    console.log(`[streaming] Clock Rate: ${rtpConsumer.rtpParameters.codecs[0]?.clockRate}`);
    if (producer.kind === 'audio') {
      console.log(`[streaming]   Channels: ${rtpConsumer.rtpParameters.codecs[0]?.channels}`);
    }
    
    this.rtpConsumers.set(producer.id, rtpConsumer);
    console.log(`[streaming] Producer ${producer.id} (${producer.kind}) piped to RTP transport for stream ${streamId}`);
      
    await this.checkAndUpdateFFmpegStream(streamId, producer);
  }

  private async checkAndUpdateFFmpegStream(streamId: string, producer: mediasoup.types.Producer): Promise<void> {
    const streamConsumers = this.getConsumersForStream(streamId);
    const hasVideo = streamConsumers.some(c => c.kind === 'video');
    const hasAudio = streamConsumers.some(c => c.kind === 'audio');
    
    console.log(`[streaming] Stream ${streamId} check: video=${hasVideo}, audio=${hasAudio}`);
    
    if (hasVideo && hasAudio) {
      // Get port information for this stream
      const ports = this.streamPorts.get(streamId)!;
      
      // Collect RTP parameters for this stream
      const rtpParams = this.collectRtpParametersForStream(streamId);
      
      console.log(`[streaming] Adding complete stream ${streamId} to FFmpeg composition`);
      await this.ffmpegService.addStream(streamId, ports.videoPort, ports.audioPort, rtpParams);

      const streamConsumers = this.getConsumersForStream(streamId);
      for (const consumer of streamConsumers) {
        if (consumer.kind === "video") {
          await consumer.requestKeyFrame();
        }
      }
    }
  }


  private getConsumersForStream(streamId: string): mediasoup.types.Consumer[] {
    const consumers: mediasoup.types.Consumer[] = [];
    for (const [producerId, consumer] of this.rtpConsumers.entries()) {
      if (this.producerToStreamId.get(producerId) === streamId) {
        consumers.push(consumer);
      }
    }
    return consumers;
  }

  private collectRtpParametersForStream(streamId: string) {
    const rtpParams: { video?: any, audio?: any } = {};
    const streamConsumers = this.getConsumersForStream(streamId);
    
    for (const consumer of streamConsumers) {
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


  async stopFFmpegIfNoProducers(): Promise<void> {
    const producerCount = this.getAllProducers().length;
    console.log(`[streaming] Checking producers: ${producerCount} active`);
    
    if (producerCount === 0) {
      console.log('[streaming] No producers left, stopping FFmpeg and cleaning up...');
      this.ffmpegService.stopFFmpeg();
      
      console.log(`[streaming] Closing ${this.rtpConsumers.size} RTP consumers`);
      this.rtpConsumers.forEach(consumer => consumer.close());
      this.rtpConsumers.clear();
      
      console.log(`[streaming] Closing ${this.streamTransports.size} stream transports`);
      for (const [streamId, transports] of this.streamTransports.entries()) {
        transports.video.close();
        transports.audio.close();
      }
      this.streamTransports.clear();
      this.streamPorts.clear();
      this.producerToStreamId.clear();
      this.nextPortPair = 5004;
      console.log('[streaming] ✅ FFmpeg cleanup completed');

    } else {
      console.log(`[streaming] Still have ${producerCount} producers, keeping FFmpeg running`);
    }
  }

  async cleanupProducer(producerId: string): Promise<void> {
    const consumer = this.rtpConsumers.get(producerId);
    const streamId = this.producerToStreamId.get(producerId);
    
    if (consumer) {
      consumer.close();
      this.rtpConsumers.delete(producerId);
    }
    
    if (streamId) {
      this.producerToStreamId.delete(producerId);
      
      // Check if this stream still has any producers
      const streamStillHasProducers = Array.from(this.producerToStreamId.values()).includes(streamId);
      
      if (!streamStillHasProducers) {
        console.log(`[streaming] Stream ${streamId} has no more producers, removing from FFmpeg`);
        await this.ffmpegService.removeStream(streamId);
        
        // Clean up stream transports
        const transports = this.streamTransports.get(streamId);
        if (transports) {
          transports.video.close();
          transports.audio.close();
          this.streamTransports.delete(streamId);
          this.streamPorts.delete(streamId);
        }
      }
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
    const hasActiveProducers = this.getAllProducers().length > 0;
    return hasActiveProducers && this.ffmpegService.isRunning() ? [{ streamId: "main", hlsUrl: "/hls/stream.m3u8" }] : [];
  }
}