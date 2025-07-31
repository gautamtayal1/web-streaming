import * as mediasoup from "mediasoup";
import { MEDIASOUP_CONFIG } from "../utils/config";

export class MediaSoupService {
  private worker!: mediasoup.types.Worker;
  private webRtcServer!: mediasoup.types.WebRtcServer;
  private router!: mediasoup.types.Router;

  async initialize(): Promise<void> {
    this.worker = await mediasoup.createWorker(MEDIASOUP_CONFIG.worker);
    this.webRtcServer = await this.worker.createWebRtcServer(MEDIASOUP_CONFIG.webRtcServer);
    this.router = await this.worker.createRouter(MEDIASOUP_CONFIG.router);
  }

  getRouter(): mediasoup.types.Router {
    return this.router;
  }

  getWebRtcServer(): mediasoup.types.WebRtcServer {
    return this.webRtcServer;
  }

  async createPlainTransport(): Promise<mediasoup.types.PlainTransport> {
    return await this.router.createPlainTransport({
      listenIp: { ip: "127.0.0.1", announcedIp: undefined },
      rtcpMux: false,
      comedia: true
    });
  }

  async createWebRtcTransport(): Promise<mediasoup.types.WebRtcTransport> {
    return await this.router.createWebRtcTransport({
      webRtcServer: this.webRtcServer,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    });
  }
}