import * as mediasoup from "mediasoup";
import { MEDIASOUP_CONFIG } from "../utils/config";

interface RtpTransportConfig {
  videoTransports: mediasoup.types.PlainTransport[];
  audioTransports: mediasoup.types.PlainTransport[];
}

export class MediaSoupService {
  private worker!: mediasoup.types.Worker;
  private webRtcServer!: mediasoup.types.WebRtcServer;
  private router!: mediasoup.types.Router;
  private rtpTransports: RtpTransportConfig = {
    videoTransports: [],
    audioTransports: [],
  };

  private readonly FIXED_PORTS = {
    video: [5004, 5008],
    audio: [5006, 5010],
    listenIp: "127.0.0.1"
  };

  async initialize(): Promise<void> {
    await this.createWorker();
    await this.createWebRtcServer();
    await this.createRouter();
    await this.initializeRtpTransports();
  }

  getRouter(): mediasoup.types.Router {
    return this.router;
  }

  getWebRtcServer(): mediasoup.types.WebRtcServer {
    return this.webRtcServer;
  }

  getRtpCapabilities(): mediasoup.types.RtpCapabilities {
    return this.router.rtpCapabilities;
  }

  async createWebRtcTransport(): Promise<mediasoup.types.WebRtcTransport> {
    return await this.router.createWebRtcTransport({
      webRtcServer: this.webRtcServer,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    });
  }

  canConsume(params: {
    producerId: string;
    rtpCapabilities: mediasoup.types.RtpCapabilities;
  }): boolean {
    return this.router.canConsume(params);
  }

  async createRtpConsumer(
    producer: mediasoup.types.Producer,
    transportIndex: number
  ): Promise<mediasoup.types.Consumer | null> {
    try {
      const rtpTransports = producer.kind === "video"
        ? this.rtpTransports.videoTransports
        : this.rtpTransports.audioTransports;
      
      const rtpTransport = rtpTransports[transportIndex];

      if (!rtpTransport) {
        console.error(
          `No RTP transport available for ${producer.kind} at index ${transportIndex}`
        );
        return null;
      }

      console.log(`Producer stats before creating consumer:`, {
        id: producer.id,
        kind: producer.kind,
        paused: producer.paused,
        closed: producer.closed,
        score: producer.score
      });

      const consumer = await rtpTransport.consume({
        producerId: producer.id,
        rtpCapabilities: this.getRtpCapabilities(),
      });

      this.logConsumerCreation(producer, consumer, transportIndex);
      this.setupConsumerEventHandlers(consumer, producer.id);

      if (consumer.paused) {
        await consumer.resume();
        console.log(`RTP consumer resumed for ${producer.kind}`);
      }
      
      await consumer.resume();
      console.log(`RTP consumer force resumed for ${producer.kind}`);
      
      if (producer.kind === 'video') {
        await consumer.requestKeyFrame();
        console.log(`Initial keyframe requested for video consumer`);
        
        setTimeout(async () => {
          if (!consumer.closed && !producer.closed) {
            await consumer.requestKeyFrame();
            console.log(`Secondary keyframe requested for video consumer`);
          }
        }, 1000);
        
        setTimeout(async () => {
          if (!consumer.closed && !producer.closed) {
            await consumer.requestKeyFrame();
            console.log(`Tertiary keyframe requested for video consumer`);
          }
        }, 3000);
      }

      return consumer;
    } catch (error) {
      console.error(
        `Failed to create RTP consumer for ${producer.kind}:`,
        error
      );
      return null;
    }
  }

  async cleanup(): Promise<void> {
    console.info("Cleaning up MediaSoup resources...");
    
    [...this.rtpTransports.videoTransports, ...this.rtpTransports.audioTransports]
      .forEach(transport => transport.close());
    
    if (this.router) {
      this.router.close();
    }

    if (this.webRtcServer) {
      this.webRtcServer.close();
    }

    if (this.worker) {
      this.worker.close();
    }
  }

  private async createWorker(): Promise<void> {
    this.worker = await mediasoup.createWorker(MEDIASOUP_CONFIG.worker);

    this.worker.on("died", () => {
      console.error("MediaSoup worker has died");
      setTimeout(() => process.exit(1), 2000);
    });

    console.info("MediaSoup worker created");
  }

  private async createWebRtcServer(): Promise<void> {
    this.webRtcServer = await this.worker.createWebRtcServer(MEDIASOUP_CONFIG.webRtcServer);
    console.info("MediaSoup WebRTC server created");
  }

  private async createRouter(): Promise<void> {
    this.router = await this.worker.createRouter(MEDIASOUP_CONFIG.router);
    console.info("MediaSoup router created");
  }

  private async initializeRtpTransports(): Promise<void> {
    try {
      await this.createVideoTransports();
      await this.createAudioTransports();
      console.log("All RTP transports initialized successfully");
    } catch (error) {
      console.error("Failed to initialize RTP transports:", error);
      throw error;
    }
  }

  private async createVideoTransports(): Promise<void> {
    const videoTransport1 = await this.createAndConnectPlainTransport(
      this.FIXED_PORTS.video[0]
    );
    this.rtpTransports.videoTransports.push(videoTransport1);
    console.log(`Video RTP transport 1 connected on port ${this.FIXED_PORTS.video[0]}`);

    const videoTransport2 = await this.createAndConnectPlainTransport(
      this.FIXED_PORTS.video[1]
    );
    this.rtpTransports.videoTransports.push(videoTransport2);
    console.log(`Video RTP transport 2 connected on port ${this.FIXED_PORTS.video[1]}`);
  }

  private async createAudioTransports(): Promise<void> {
    const audioTransport1 = await this.createAndConnectPlainTransport(
      this.FIXED_PORTS.audio[0]
    );
    this.rtpTransports.audioTransports.push(audioTransport1);
    console.log(`Audio RTP transport 1 connected on port ${this.FIXED_PORTS.audio[0]}`);

    const audioTransport2 = await this.createAndConnectPlainTransport(
      this.FIXED_PORTS.audio[1]
    );
    this.rtpTransports.audioTransports.push(audioTransport2);
    console.log(`Audio RTP transport 2 connected on port ${this.FIXED_PORTS.audio[1]}`);
  }

  private async createAndConnectPlainTransport(port: number): Promise<mediasoup.types.PlainTransport> {
    const transport = await this.router.createPlainTransport({
      listenIp: this.FIXED_PORTS.listenIp,
      rtcpMux: false,
      comedia: false,
    });

    await transport.connect({
      ip: this.FIXED_PORTS.listenIp,
      port: port,
      rtcpPort: port + 1,
    });

    console.log(`PlainTransport connected to send RTP to ${this.FIXED_PORTS.listenIp}:${port}`);
    return transport;
  }

  private logConsumerCreation(
    producer: mediasoup.types.Producer,
    consumer: mediasoup.types.Consumer,
    transportIndex: number
  ): void {
    const ports = producer.kind === "video"
      ? this.FIXED_PORTS.video
      : this.FIXED_PORTS.audio;

    console.log(`Created RTP consumer for ${producer.kind}:`, {
      producerId: producer.id,
      consumerId: consumer.id,
      transportIndex: transportIndex,
      port: ports[transportIndex],
      payloadType: consumer.rtpParameters.codecs[0]?.payloadType,
    });
  }

  private setupConsumerEventHandlers(consumer: mediasoup.types.Consumer, producerId: string): void {
    consumer.on("transportclose", () => {
      console.log(`RTP consumer closed for producer ${producerId}`);
    });

    consumer.on("producerclose", () => {
      console.log(`RTP consumer closed due to producer close for ${producerId}`);
    });
  }
}