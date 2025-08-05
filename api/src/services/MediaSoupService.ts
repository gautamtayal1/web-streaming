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

      const consumer = await rtpTransport.consume({
        producerId: producer.id,
        rtpCapabilities: this.getRtpCapabilities(),
      });

      if (producer.kind === 'video') {
        await consumer.requestKeyFrame();
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

    const videoTransport2 = await this.createAndConnectPlainTransport(
      this.FIXED_PORTS.video[1]
    );
    this.rtpTransports.videoTransports.push(videoTransport2);
  }

  private async createAudioTransports(): Promise<void> {
    const audioTransport1 = await this.createAndConnectPlainTransport(
      this.FIXED_PORTS.audio[0]
    );
    this.rtpTransports.audioTransports.push(audioTransport1);

    const audioTransport2 = await this.createAndConnectPlainTransport(
      this.FIXED_PORTS.audio[1]
    );
    this.rtpTransports.audioTransports.push(audioTransport2);
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

    return transport;
  }
}