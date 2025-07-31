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
      console.log(`[server] 🔌 New WebSocket connection: ${peerId}`);
      
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
      console.log(`[server] WebSocket closed for peer: ${peerId}`);
      const peer = this.peers.get(peerId);
      if (peer) {
        console.log(`[server] Cleaning up ${peer.producers.length} producers and ${peer.consumers.length} consumers`);
        peer.producers.forEach(producer => producer.close());
        peer.consumers.forEach(consumer => consumer.close());
        peer.sendTransport?.close();
        peer.recvTransport?.close();
      }
      this.peers.delete(peerId);
      
      console.log(`[server] Remaining peers: ${this.peers.size}`);
      if (this.peers.size === 0) {
        console.log(`[server] No peers left, stopping FFmpeg...`);
        this.streamingService.cleanupFFmpegStreams();
      }
    });
  }

  public async start(): Promise<void> {
    try {
      console.log('[server] Initializing MediaSoup service...');
      await this.mediaSoupService.initialize();
      console.log('[server] MediaSoup service initialized successfully');
      
      console.log('[server] Initializing other services...');
      this.initializeServices();
      console.log('[server] Services initialized successfully');
      
      console.log('[server] Setting up routes...');
      this.setupRoutes();
      console.log('[server] Routes set up successfully');
      
      console.log('[server] Starting HTTP server...');
      const server = this.app.listen(SERVER_CONFIG.port, '0.0.0.0', () => {
        console.log(`[server] HTTP server running on http://localhost:${SERVER_CONFIG.port}`);
        console.log(`[server] Server bound to 0.0.0.0:${SERVER_CONFIG.port}`);
      });
      
      server.on('error', (error) => {
        console.error('[server] HTTP server error:', error);
      });

      console.log('[server] Setting up WebSocket server...');
      this.setupWebSocketServer(server);
      console.log('[server] WebSocket server set up successfully');
      
      console.log('[server] ✅ Server startup completed successfully');
      
    } catch (error) {
      console.error('[server] ❌ Server startup failed:', error);
      throw error;
    }
  }
}

const streamingServer = new StreamingServer();
streamingServer.start().catch(console.error);