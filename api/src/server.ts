import express from "express";
import { WebSocketServer } from "ws";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";
import cors from "cors";

import { MediaSoupService } from "./services/MediaSoupService";
import { FFmpegService } from "./services/FFmpegService";
import { StreamingService } from "./services/StreamingService";
import { WebSocketHandler } from "./services/WebSocketHandler";
import { createStreamRoutes } from "./routes/streamRoutes";
import { Peer, FFmpegStream } from "./utils/types";
import { SERVER_CONFIG } from "./utils/config";

class StreamingServer {
  private app = express();
  private peers = new Map<string, Peer>();
  private ffmpegStreams = new Map<string, FFmpegStream>();
  private hlsDir = join(process.cwd(), SERVER_CONFIG.hlsDir);
  
  private mediaSoupService = new MediaSoupService();
  private ffmpegService = new FFmpegService();
  private streamingService!: StreamingService;
  private webSocketHandler!: WebSocketHandler;

  constructor() {
    this.setupMiddleware();
    this.ensureHlsDirectory();
  }

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());
    
    // Serve HLS files with proper headers for streaming
    this.app.use('/hls', express.static(this.hlsDir, {
      setHeaders: (res, path) => {
        if (path.endsWith('.m3u8')) {
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
          res.setHeader('Cache-Control', 'no-cache');
        } else if (path.endsWith('.ts')) {
          res.setHeader('Content-Type', 'video/mp2t'); 
          res.setHeader('Cache-Control', 'no-cache');
        }
      }
    }));
  }

  private ensureHlsDirectory(): void {
    if (!existsSync(this.hlsDir)) {
      mkdirSync(this.hlsDir, { recursive: true });
    }
  }

  private initializeServices(): void {
    this.streamingService = new StreamingService(
      this.mediaSoupService,
      this.ffmpegService,
      this.peers,
      this.ffmpegStreams
    );

    this.webSocketHandler = new WebSocketHandler(
      this.mediaSoupService,
      this.peers,
      this.streamingService
    );
  }

  private setupRoutes(): void {
    const streamRoutes = createStreamRoutes(this.streamingService, this.ffmpegStreams);
    this.app.use('/', streamRoutes);
  }

  private setupWebSocketServer(server: any): void {
    const wss = new WebSocketServer({ server });
    
    wss.on("connection", (socket) => {
      const peerId = crypto.randomUUID();
      this.peers.set(peerId, { 
        socket: socket as unknown as WebSocket, 
        producers: [], 
        consumers: [] 
      });

      socket.send(JSON.stringify({
        type: "routerRtpCapabilities",
        data: this.mediaSoupService.getRouter().rtpCapabilities,
      }));

      this.webSocketHandler.notifyExistingProducers(socket, peerId);
      this.setupSocketHandlers(socket, peerId);
      this.setupSocketCleanup(socket, peerId);
    });
  }

  private setupSocketHandlers(socket: any, peerId: string): void {
    socket.on("message", async (msgRaw: Buffer) => {
      try {
        const msg = JSON.parse(msgRaw.toString());
        const peer = this.peers.get(peerId);
        if (!peer) return;

        await this.webSocketHandler.handleMessage(msg, peer, socket, peerId);
      } catch (error) {
        console.error("WebSocket message error:", error);
      }
    });
  }

  private setupSocketCleanup(socket: any, peerId: string): void {
    socket.on("close", () => {
      const peer = this.peers.get(peerId);
      if (peer) {
        peer.producers.forEach(producer => producer.close());
        peer.consumers.forEach(consumer => consumer.close());
        peer.sendTransport?.close();
        peer.recvTransport?.close();
      }
      this.peers.delete(peerId);
      
      if (this.peers.size === 0) {
        this.streamingService.cleanupFFmpegStreams();
      }
    });
  }

  public async start(): Promise<void> {
    await this.mediaSoupService.initialize();
    this.initializeServices();
    this.setupRoutes();
    
    const server = this.app.listen(SERVER_CONFIG.port, () => {
      console.log(`Streaming server running on http://localhost:${SERVER_CONFIG.port}`);
    });

    this.setupWebSocketServer(server);
  }
}

// Start the server
const streamingServer = new StreamingServer();
streamingServer.start().catch(console.error);