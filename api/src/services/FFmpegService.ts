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
    // Legacy method - use default parameters
    return this.startFFmpegWithParams(videoPort, audioPort, {});
  }

  startFFmpegWithParams(videoPort: number, audioPort: number, rtpParams: any): ChildProcess {
    console.log(`[ffmpeg] Starting FFmpeg to listen on video port: ${videoPort}, audio port: ${audioPort}`);
    console.log(`[ffmpeg] RTP Parameters:`, rtpParams);
    
    // Generate SDP content based on actual RTP parameters
    const videoSdpContent = this.generateVideoSdp(videoPort, rtpParams.video);
    const audioSdpContent = this.generateAudioSdp(audioPort, rtpParams.audio);

    // Write SDP files
    const videoSdpPath = join(this.hlsDir, 'video.sdp');
    const audioSdpPath = join(this.hlsDir, 'audio.sdp');
    writeFileSync(videoSdpPath, videoSdpContent);
    writeFileSync(audioSdpPath, audioSdpContent);

    console.log(`[ffmpeg] Created SDP files: video=${videoSdpPath}, audio=${audioSdpPath}`);

    // FFmpeg args with better error handling for live streams
    const ffmpegArgs = [
      '-re', // Read input at its native frame rate (important for live streams)
      '-protocol_whitelist', 'file,udp,rtp,crypto,data',
      '-fflags', '+genpts+igndts', // Generate presentation timestamps and ignore input DTS
      '-max_delay', '500000', // 500ms max delay for real-time streams
      '-i', videoSdpPath,
      '-protocol_whitelist', 'file,udp,rtp,crypto,data',
      '-i', audioSdpPath,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-preset', 'ultrafast', // Fastest encoding for real-time
      '-tune', 'zerolatency',
      '-avoid_negative_ts', 'make_zero', // Handle timestamp issues
      '-use_wallclock_as_timestamps', '1', // Use wall clock for timestamps
      '-f', 'hls',
      '-hls_time', '2', // 2 second segments
      '-hls_list_size', '5', // Keep 5 segments
      '-hls_flags', 'delete_segments+independent_segments+program_date_time',
      '-hls_allow_cache', '0',
      join(this.hlsDir, 'stream.m3u8')
    ];

    console.log(`[ffmpeg] Command: ffmpeg ${ffmpegArgs.join(' ')}`);
    this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

    this.ffmpegProcess.on('error', (err) => {
      console.error('[ffmpeg] Error:', err);
    });
    
    this.ffmpegProcess.on('exit', (code, signal) => {
      console.log(`[ffmpeg] Process exited with code: ${code}, signal: ${signal}`);
      this.ffmpegProcess = null;
    });
    
    this.ffmpegProcess.stderr?.on('data', (data) => {
      const output = data.toString();
      console.log('[ffmpeg] stderr:', output.trim());
    });

    this.ffmpegProcess.stdout?.on('data', (data) => {
      console.log('[ffmpeg] stdout:', data.toString());
    });

    return this.ffmpegProcess;
  }


  // Remove the test pattern methods - only use real RTP streams

  stopFFmpeg(): void {
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill('SIGINT');
      this.ffmpegProcess = null;
    }
  }

  isRunning(): boolean {
    return this.ffmpegProcess !== null;
  }

  private generateCombinedSdp(port: number, rtpParams: any): string {
    const videoParams = rtpParams.video;
    const audioParams = rtpParams.audio;
    
    if (!videoParams || !audioParams) {
      throw new Error('Both video and audio parameters are required for combined SDP');
    }

    const videoPayloadType = videoParams.payloadType || 96;
    const audioPayloadType = audioParams.payloadType || 97;
    const videoCodec = videoParams.mimeType?.split('/')[1] || 'VP8';
    const audioCodec = audioParams.mimeType?.split('/')[1] || 'opus';
    
    return `v=0
o=- 0 0 IN IP4 127.0.0.1
s=FFMPEG_COMBINED
c=IN IP4 127.0.0.1
t=0 0
m=video ${port} RTP/AVP ${videoPayloadType}
a=rtpmap:${videoPayloadType} ${videoCodec}/${videoParams.clockRate}
m=audio ${port} RTP/AVP ${audioPayloadType}
a=rtpmap:${audioPayloadType} ${audioCodec}/${audioParams.clockRate}/${audioParams.channels}`;
  }

  private generateVideoSdp(port: number, videoParams?: any): string {
    if (!videoParams) {
      // Fallback to default H264
      return `v=0
o=- 0 0 IN IP4 127.0.0.1
s=FFMPEG_VIDEO
c=IN IP4 127.0.0.1
t=0 0
m=video ${port} RTP/AVP 96
a=rtpmap:96 H264/90000`;
    }

    const mimeType = videoParams.mimeType || 'video/H264';
    const payloadType = videoParams.payloadType || 96;
    const clockRate = videoParams.clockRate || 90000;
    
    // Extract codec name from mimeType (e.g., "video/VP8" -> "VP8")
    const codecName = mimeType.split('/')[1];
    
    return `v=0
o=- 0 0 IN IP4 127.0.0.1
s=FFMPEG_VIDEO
c=IN IP4 127.0.0.1
t=0 0
m=video ${port} RTP/AVP ${payloadType}
a=rtpmap:${payloadType} ${codecName}/${clockRate}`;
  }

  private generateAudioSdp(port: number, audioParams?: any): string {
    if (!audioParams) {
      // Fallback to default Opus
      return `v=0
o=- 0 0 IN IP4 127.0.0.1
s=FFMPEG_AUDIO
c=IN IP4 127.0.0.1
t=0 0
m=audio ${port} RTP/AVP 97
a=rtpmap:97 opus/48000/2`;
    }

    const mimeType = audioParams.mimeType || 'audio/opus';
    const payloadType = audioParams.payloadType || 97;
    const clockRate = audioParams.clockRate || 48000;
    const channels = audioParams.channels || 2;
    
    // Extract codec name from mimeType (e.g., "audio/opus" -> "opus")
    const codecName = mimeType.split('/')[1];
    
    return `v=0
o=- 0 0 IN IP4 127.0.0.1
s=FFMPEG_AUDIO
c=IN IP4 127.0.0.1
t=0 0
m=audio ${port} RTP/AVP ${payloadType}
a=rtpmap:${payloadType} ${codecName}/${clockRate}/${channels}`;
  }
}