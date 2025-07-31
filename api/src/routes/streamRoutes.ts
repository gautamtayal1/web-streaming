import express from "express";
import { StreamingService } from "../services/StreamingService";
import { FFmpegStream } from "../utils/types";

export function createStreamRoutes(
  streamingService: StreamingService,
  ffmpegStreams: Map<string, FFmpegStream>
) {
  const router = express.Router();

  // Health check endpoint
  router.get('/health', (_, res) => {
    res.json({ status: 'ok' });
  });

  router.post('/create-stream', async (_, res) => {
    const streamId = crypto.randomUUID();
    try {
      const ffmpegStream = await streamingService.createFFmpegStream(streamId);
      ffmpegStreams.set(streamId, ffmpegStream);
      
      res.json({ 
        streamId, 
        hlsUrl: `/hls/stream.m3u8`, // Use single stream file like in your reference
        ports: {
          videoRtp: ffmpegStream.videoRtpPort,
          videoRtcp: ffmpegStream.videoRtcpPort,
          audioRtp: ffmpegStream.audioRtpPort,
          audioRtcp: ffmpegStream.audioRtcpPort
        }
      });
    } catch (error) {
      console.error('Failed to create stream:', error);
      res.status(500).json({ error: 'Failed to create stream' });
    }
  });

  router.get('/streams', (_, res) => {
    const activeStreams = streamingService.getActiveStreams();
    res.json({ streams: activeStreams });
  });

  // Check if HLS stream file exists (for watch page)
  router.get('/stream-status', (_, res) => {
    const fs = require('fs');
    const path = require('path');
    const hlsDir = path.join(process.cwd(), 'hls');
    const streamFile = path.join(hlsDir, 'stream.m3u8');
    
    const exists = fs.existsSync(streamFile);
    res.json({ 
      active: exists,
      hlsUrl: exists ? '/hls/stream.m3u8' : null 
    });
  });

  return router;
}