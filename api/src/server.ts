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
    const streamRoutes = createStreamRoutes();
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
    socket.on("close", async () => {
      const peer = this.peers.get(peerId);
      if (peer) {
        
        for (const producer of peer.producers) {
          await this.streamingService.cleanupProducer(producer.id);
          producer.close();
        }
        
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
    try {
      await this.mediaSoupService.initialize();
      this.initializeServices();
      this.setupRoutes();
      
      const server = this.app.listen(SERVER_CONFIG.port, '0.0.0.0', () => {
        console.log(`[server] Server running on http://localhost:${SERVER_CONFIG.port}`);
      });
      
      server.on('error', (error) => {
        console.error('[server] HTTP server error:', error);
      });
      this.setupWebSocketServer(server);

    } catch (error) {
      console.error('[server] ❌ Server startup failed:', error);
      throw error;
    }
  }

  public async cleanup(): Promise<void> {
    
    this.ffmpegService.stopFFmpeg();
    
    for (const [peerId, peer] of this.peers) {
      peer.producers.forEach(producer => producer.close());
      peer.consumers.forEach(consumer => consumer.close());
      peer.sendTransport?.close();
      peer.recvTransport?.close();
    }
    this.peers.clear();
    
    await this.streamingService.stopFFmpegIfNoProducers();
    await this.mediaSoupService.cleanup();
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    this.cleanupHlsFiles();
  }

  private cleanupHlsFiles(): void {
    try {
      const fs = require('fs');
      if (fs.existsSync(this.hlsDir)) {
        const files = fs.readdirSync(this.hlsDir);
        files.forEach((file: string) => {
          if (file.endsWith('.m3u8') || file.endsWith('.ts') || file.endsWith('.sdp')) {
            fs.unlinkSync(join(this.hlsDir, file));
          }
        });
      }
    } catch (error) {
      console.error('[server] Error cleaning HLS files:', error);
    }
  }
}

const streamingServer = new StreamingServer();

process.on('SIGINT', async () => {
  console.log('[server] SIGINT received, cleaning up...');
  await streamingServer.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[server] SIGTERM received, cleaning up...');
  await streamingServer.cleanup();
  process.exit(0);
});

process.on('exit', () => {
  console.log('[server] Process exiting, cleanup complete');
});

streamingServer.start().catch(console.error);