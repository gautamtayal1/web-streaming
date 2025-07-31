import { FFmpegStream, Peer } from "../types";
import { MediaSoupService } from "./MediaSoupService";
import { FFmpegService } from "./FFmpegService";

export class StreamingService {
  constructor(
    private mediaSoupService: MediaSoupService,
    private ffmpegService: FFmpegService,
    private peers: Map<string, Peer>,
    private ffmpegStreams: Map<string, FFmpegStream>
  ) {}

  async createFFmpegStream(streamId: string): Promise<FFmpegStream> {
    const videoPlainTransport = await this.mediaSoupService.createPlainTransport();
    const audioPlainTransport = await this.mediaSoupService.createPlainTransport();

    const ffmpegStream: FFmpegStream = {
      videoPlainTransport,
      audioPlainTransport,
      videoRtpPort: videoPlainTransport.tuple.localPort,
      audioRtpPort: audioPlainTransport.tuple.localPort,
      videoRtcpPort: videoPlainTransport.rtcpTuple?.localPort || videoPlainTransport.tuple.localPort + 1,
      audioRtcpPort: audioPlainTransport.rtcpTuple?.localPort || audioPlainTransport.tuple.localPort + 1
    };

    await this.createConsumers(ffmpegStream);
    
    if (ffmpegStream.videoConsumer || ffmpegStream.audioConsumer) {
      ffmpegStream.ffmpegProcess = await this.ffmpegService.startFFmpegProcess(streamId, ffmpegStream);
    }

    return ffmpegStream;
  }

  private async createConsumers(ffmpegStream: FFmpegStream): Promise<void> {
    const allProducers = this.getAllProducers();
    const router = this.mediaSoupService.getRouter();

    for (const producer of allProducers) {
      if (producer.kind === "video" && !ffmpegStream.videoConsumer) {
        if (router.canConsume({ 
          producerId: producer.id, 
          rtpCapabilities: router.rtpCapabilities 
        })) {
          ffmpegStream.videoConsumer = await ffmpegStream.videoPlainTransport.consume({
            producerId: producer.id,
            rtpCapabilities: router.rtpCapabilities,
            paused: false
          });
        }
      } else if (producer.kind === "audio" && !ffmpegStream.audioConsumer) {
        if (router.canConsume({ 
          producerId: producer.id, 
          rtpCapabilities: router.rtpCapabilities 
        })) {
          ffmpegStream.audioConsumer = await ffmpegStream.audioPlainTransport.consume({
            producerId: producer.id,
            rtpCapabilities: router.rtpCapabilities,
            paused: false
          });
        }
      }
    }
  }

  private getAllProducers() {
    const allProducers = [];
    for (const peer of this.peers.values()) {
      allProducers.push(...peer.producers);
    }
    return allProducers;
  }

  cleanupFFmpegStreams(): void {
    for (const [, stream] of this.ffmpegStreams) {
      stream.ffmpegProcess?.kill();
      stream.videoPlainTransport?.close();
      stream.audioPlainTransport?.close();
    }
    this.ffmpegStreams.clear();
  }

  getActiveStreams() {
    return Array.from(this.ffmpegStreams.keys()).map(streamId => ({
      streamId,
      hlsUrl: `/hls/${streamId}.m3u8`
    }));
  }
}