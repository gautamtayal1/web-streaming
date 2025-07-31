import { spawn, ChildProcess } from "child_process";
import { join } from "path";
import { writeFileSync, existsSync, mkdirSync } from "fs";

export class FFmpegService {
  private hlsDir: string;
  private ffmpegProcess: ChildProcess | null = null;

  constructor() {
    this.hlsDir = join(process.cwd(), "hls");
    if (!existsSync(this.hlsDir)) {
      mkdirSync(this.hlsDir, { recursive: true });
    }
  }

  startFFmpeg(videoPort: number, audioPort: number): ChildProcess {
    // Generate separate SDP files for video and audio (like reference)
    const videoSdpContent = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=FFMPEG_VIDEO
c=IN IP4 127.0.0.1
t=0 0
m=video ${videoPort} RTP/AVP 101
a=rtpmap:101 VP8/90000`;

    const audioSdpContent = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=FFMPEG_AUDIO
c=IN IP4 127.0.0.1
t=0 0
m=audio ${audioPort} RTP/AVP 102
a=rtpmap:102 opus/48000/2`;

    // Write SDP files
    const videoSdpPath = join(this.hlsDir, 'video.sdp');
    const audioSdpPath = join(this.hlsDir, 'audio.sdp');
    writeFileSync(videoSdpPath, videoSdpContent);
    writeFileSync(audioSdpPath, audioSdpContent);

    // FFmpeg args exactly like reference
    const ffmpegArgs = [
      '-protocol_whitelist', 'file,udp,rtp',
      '-i', videoSdpPath,
      '-i', audioSdpPath,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-f', 'hls',
      '-hls_time', '1',
      '-hls_list_size', '3',
      '-hls_flags', 'delete_segments+program_date_time',
      join(this.hlsDir, 'stream.m3u8')
    ];

    console.log(`[ffmpeg] Starting: ffmpeg ${ffmpegArgs.join(' ')}`);
    this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

    this.ffmpegProcess.on('error', (err) => console.error('[ffmpeg] Error:', err));
    this.ffmpegProcess.on('exit', (code, signal) => console.log(`[ffmpeg] Exited: ${code} ${signal}`));
    this.ffmpegProcess.stderr?.on('data', (data) => console.log('[ffmpeg]:', data.toString()));

    return this.ffmpegProcess;
  }

  stopFFmpeg(): void {
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill('SIGINT');
      this.ffmpegProcess = null;
    }
  }

  isRunning(): boolean {
    return this.ffmpegProcess !== null;
  }
}