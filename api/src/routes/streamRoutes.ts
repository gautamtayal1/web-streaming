import express from "express";

export function createStreamRoutes() {
  const router = express.Router();


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