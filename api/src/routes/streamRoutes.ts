import express from "express";
import { StreamingService } from "../services/StreamingService";
import { FFmpegStream } from "../types";

export function createStreamRoutes(
  streamingService: StreamingService,
  ffmpegStreams: Map<string, FFmpegStream>
) {
  const router = express.Router();

  router.post('/create-stream', async (_, res) => {
    const streamId = crypto.randomUUID();
    try {
      const ffmpegStream = await streamingService.createFFmpegStream(streamId);
      ffmpegStreams.set(streamId, ffmpegStream);
      
      res.json({ 
        streamId, 
        hlsUrl: `/hls/${streamId}.m3u8`,
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

  return router;
}