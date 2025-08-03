import { spawn, ChildProcess } from "child_process";
import { join } from "path";
import { writeFileSync, existsSync, mkdirSync } from "fs";

export class FFmpegService {
  private hlsDir: string;
  private ffmpegProcess: ChildProcess | null = null;
  private activeStreams: Map<string, { videoPort: number, audioPort: number, rtpParams: any }> = new Map();

  constructor() {
    this.hlsDir = join(process.cwd(), "hls");
    if (!existsSync(this.hlsDir)) {
      mkdirSync(this.hlsDir, { recursive: true });
    }
  }

  async addStream(streamId: string, videoPort: number, audioPort: number, rtpParams: any): Promise<void> {
    this.activeStreams.set(streamId, { videoPort, audioPort, rtpParams });
    console.log(`[ffmpeg] Added stream ${streamId} - total streams: ${this.activeStreams.size}`);
    await this.restartFFmpegWithComposition();
  }

  async removeStream(streamId: string): Promise<void> {
    this.activeStreams.delete(streamId);
    console.log(`[ffmpeg] Removed stream ${streamId} - total streams: ${this.activeStreams.size}`);
    if (this.activeStreams.size === 0) {
      this.stopFFmpeg();
    } else {
      await this.restartFFmpegWithComposition();
    }
  }

  async restartFFmpegWithComposition(): Promise<void> {
    if (this.ffmpegProcess) {
      console.log('[ffmpeg] Stopping existing process before restart...');
      await this.stopFFmpegGracefully();
    }
    
    if (this.activeStreams.size === 0) {
      return;
    }

    console.log(`[ffmpeg] Starting composed stream with ${this.activeStreams.size} inputs`);
    this.startComposedFFmpeg();
  }

  private stopFFmpegGracefully(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.ffmpegProcess) {
        resolve();
        return;
      }

      const process = this.ffmpegProcess;
      
      // Set up exit handler
      const onExit = () => {
        this.ffmpegProcess = null;
        resolve();
      };

      process.once('exit', onExit);
      process.once('error', onExit);

      // Send SIGTERM first, then SIGKILL if needed
      process.kill('SIGINT'); 
      
      // Force kill after 3 seconds if still running
      setTimeout(() => {
        if (this.ffmpegProcess === process) {
          console.log('[ffmpeg] Force killing process...');
          process.kill('SIGKILL');
        }
      }, 3000);
    });
  }

  private startComposedFFmpeg(): void {
    const streams = Array.from(this.activeStreams.values());
    const streamIds = Array.from(this.activeStreams.keys());
    
    const sdpPaths: string[] = [];
    const ffmpegArgs: string[] = [];

    // Generate SDP files for each stream
    streams.forEach((stream, index) => {
      const videoSdpContent = this.generateVideoSdp(stream.videoPort, stream.rtpParams.video);
      const audioSdpContent = this.generateAudioSdp(stream.audioPort, stream.rtpParams.audio);
      
      const videoSdpPath = join(this.hlsDir, `video_${index}.sdp`);
      const audioSdpPath = join(this.hlsDir, `audio_${index}.sdp`);
      
      writeFileSync(videoSdpPath, videoSdpContent);
      writeFileSync(audioSdpPath, audioSdpContent);
      
      sdpPaths.push(videoSdpPath, audioSdpPath);
    });

    // Base FFmpeg args - aggressive timestamp normalization for multi-stream sync
    ffmpegArgs.push('-fflags', '+genpts+ignidx+discardcorrupt');
    ffmpegArgs.push('-avoid_negative_ts', 'make_zero');
    ffmpegArgs.push('-max_delay', '50000');
    ffmpegArgs.push('-rtbufsize', '8M');
    ffmpegArgs.push('-probesize', '100000');
    ffmpegArgs.push('-analyzeduration', '50000');
    ffmpegArgs.push('-thread_queue_size', '512');

    // Add all input streams with aggressive sync
    sdpPaths.forEach((sdpPath, index) => {
      ffmpegArgs.push('-protocol_whitelist', 'file,udp,rtp,crypto,data');
      ffmpegArgs.push('-rw_timeout', '2000000');
      ffmpegArgs.push('-f', 'sdp');
      // ffmpegArgs.push('-re');
      ffmpegArgs.push('-i', sdpPath);
    });

    // Create video composition using xstack and audio mix using amix
    const filterComplex = this.createFilterComplex(streams.length);

    ffmpegArgs.push('-filter_complex', filterComplex);
    ffmpegArgs.push('-map', '[vout]');
    ffmpegArgs.push('-map', '[aout]');
    ffmpegArgs.push('-c:v', 'libx264');
    ffmpegArgs.push('-c:a', 'aac');
    ffmpegArgs.push('-preset', 'veryfast');
    ffmpegArgs.push('-tune', 'zerolatency');
    ffmpegArgs.push('-g', '60');
    ffmpegArgs.push('-keyint_min', '60');
    ffmpegArgs.push('-r', '30');
    ffmpegArgs.push('-fps_mode', 'cfr');
    ffmpegArgs.push('-b:v', '2000k');
    ffmpegArgs.push('-b:a', '128k');
    ffmpegArgs.push('-f', 'hls');
    ffmpegArgs.push('-hls_time', '2');
    ffmpegArgs.push('-hls_list_size', '6');
    // ffmpegArgs.push('-hls_flags', 'delete_segments+independent_segments');
    ffmpegArgs.push(
      '-hls_flags',
      'delete_segments+independent_segments+append_list+discont_start'
      );
    ffmpegArgs.push('-hls_segment_type', 'mpegts');
    ffmpegArgs.push('-hls_segment_filename', join(this.hlsDir, 'segment_%03d.ts'));
    // ffmpegArgs.push('-start_number', '0');
    ffmpegArgs.push('-force_key_frames', 'expr:gte(t,n_forced*2)');
    ffmpegArgs.push(join(this.hlsDir, 'stream.m3u8'));

    console.log(`[ffmpeg] Composed stream command: ffmpeg ${ffmpegArgs.join(' ')}`);
    this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

    this.setupFFmpegHandlers();
  }

  private createFilterComplex(streamCount: number): string {
    if (streamCount === 1) {
      return '[0:v]scale=1280:720:eval=init[vout];[1:a]aresample=48000[aout]';
    }

    // Simple approach - just like single user but side by side
    if (streamCount === 2) {
      return '[0:v]scale=640:360:eval=init[v0];[2:v]scale=640:360:eval=init[v1];[v0][v1]hstack[vout];[1:a][3:a]amix=inputs=2[aout]';
    }

    // For more than 2 users, use basic grid layout
    const videoScales = [];
    const audioInputs = [];
    
    for (let i = 0; i < streamCount; i++) {
      const videoIndex = i * 2;
      const audioIndex = i * 2 + 1;
      videoScales.push(`[${videoIndex}:v]scale=320:240:eval=init[v${i}]`);
      audioInputs.push(`[${audioIndex}:a]`);
    }
    
    const videoInputs = Array.from({length: streamCount}, (_, i) => `[v${i}]`).join('');
    const layout = this.createXStackLayout(streamCount);
    const videoFilter = `${videoInputs}xstack=inputs=${streamCount}:layout=${layout}[vout]`;
    const audioFilter = `${audioInputs.join('')}amix=inputs=${streamCount}[aout]`;

    return `${videoScales.join(';')};${videoFilter};${audioFilter}`;
  }

  private createXStackLayout(streamCount: number): string {
    if (streamCount === 2) {
      // Side by side: first at 0,0 second at width of first (640),0
      return '0_0|w0_0';
    } else if (streamCount === 3) {
      // Two on top, one centered below
      return '0_0|w0_0|w0/2_h0';
    } else if (streamCount === 4) {
      // 2x2 grid
      return '0_0|w0_0|0_h0|w0_h0';
    } else {
      // For more streams, create a grid layout
      const cols = Math.ceil(Math.sqrt(streamCount));
      const layout = [];
      
      for (let i = 0; i < streamCount; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        
        if (col === 0 && row === 0) {
          layout.push('0_0');
        } else if (row === 0) {
          layout.push(`w${col-1}_0`);
        } else if (col === 0) {
          layout.push(`0_h${row-1}`);
        } else {
          layout.push(`w${col-1}_h${row-1}`);
        }
      }
      
      return layout.join('|');
    }
  }

  private setupFFmpegHandlers(): void {
    if (!this.ffmpegProcess) return;

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
  }

  // Legacy method for backward compatibility
  async startFFmpegWithParams(videoPort: number, audioPort: number, rtpParams: any): Promise<ChildProcess> {
    const streamId = `legacy_${videoPort}_${audioPort}`;
    await this.addStream(streamId, videoPort, audioPort, rtpParams);
    return this.ffmpegProcess!;
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

  getActiveStreamCount(): number {
    return this.activeStreams.size;
  }

  clearAllStreams(): void {
    this.activeStreams.clear();
    console.log('[ffmpeg] Cleared all streams from FFmpeg service');
  }

  addStreamWithoutRestart(streamId: string, videoPort: number, audioPort: number, rtpParams: any): void {
    this.activeStreams.set(streamId, { videoPort, audioPort, rtpParams });
    console.log(`[ffmpeg] Added stream ${streamId} without restart - total streams: ${this.activeStreams.size}`);
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

  public updateSDPFiles(streamId: string, videoPort: number, audioPort: number, rtpParams: any): void {
    console.log(`[ffmpeg] Updating SDP files for stream ${streamId} after consumer resume`);
    
    // Find the stream index
    const streamIds = Array.from(this.activeStreams.keys());
    const streamIndex = streamIds.indexOf(streamId);
    
    if (streamIndex === -1) {
      console.error(`[ffmpeg] Stream ${streamId} not found in active streams`);
      return;
    }
    
    // Generate fresh SDP content with current timestamp to reset sequence numbers
    const videoSdpContent = this.generateVideoSdp(videoPort, rtpParams.video);
    const audioSdpContent = this.generateAudioSdp(audioPort, rtpParams.audio);
    
    const videoSdpPath = join(this.hlsDir, `video_${streamIndex}.sdp`);
    const audioSdpPath = join(this.hlsDir, `audio_${streamIndex}.sdp`);
    
    // Write fresh SDP files
    writeFileSync(videoSdpPath, videoSdpContent);
    writeFileSync(audioSdpPath, audioSdpContent);
    
    console.log(`[ffmpeg] Updated SDP files for stream ${streamId}: video_${streamIndex}.sdp, audio_${streamIndex}.sdp`);
  }
}