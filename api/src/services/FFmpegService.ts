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

  private stopFFmpegGracefully(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.ffmpegProcess) {
        resolve();
        return;
      }

      const process = this.ffmpegProcess;
      
      const onExit = () => {
        this.ffmpegProcess = null;
        resolve();
      };

      process.once('exit', onExit);
      process.once('error', onExit);

      process.kill('SIGINT'); 
      
      setTimeout(() => {
        if (this.ffmpegProcess === process) {
          console.log('[ffmpeg] Force killing process...');
          process.kill('SIGKILL');
        }
      }, 3000);
    });
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
  }

  async startWithStaticSDP(): Promise<void> {
    if (this.ffmpegProcess) {
        await this.stopFFmpegGracefully();
    }
    this.startStaticFFmpeg();
  }

  private startStaticFFmpeg(): void {
    const staticSdpPath = join(this.hlsDir, 'stream.sdp');
    
    this.createStaticSdpFile(staticSdpPath);

    const ffmpegArgs = [
      '-protocol_whitelist', 'file,udp,rtp',
      '-fflags', '+genpts+discardcorrupt+igndts+flush_packets',
      '-analyzeduration', '500000',
      '-probesize', '500000',
      '-max_delay', '50000',
      '-buffer_size', '16384',
      '-thread_queue_size', '512',
      '-avoid_negative_ts', 'make_zero',
      '-reorder_queue_size', '0',
      '-rtbufsize', '16M',
      '-use_wallclock_as_timestamps', '1',
      '-i', staticSdpPath,
      '-r', '30',
      '-filter_complex',
      '[0:0]scale=640:480:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=640:480:(ow-iw)/2:(oh-ih)/2,fps=30[v0]; ' +
      '[0:2]scale=640:480:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=640:480:(ow-iw)/2:(oh-ih)/2,fps=30[v1]; ' +
      '[v0][v1]hstack=inputs=2[v]; ' +
      '[0:1][0:3]amerge=inputs=2,aresample=48000[a]',
      '-map', '[v]',
      '-map', '[a]',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p',
      '-g', '30',
      '-sc_threshold', '0',
      '-bf', '2',
      '-refs', '3',
      '-crf', '23',
      '-maxrate', '2000k',
      '-bufsize', '4000k',
      '-threads', '4',
      '-x264opts', 'keyint=30:min-keyint=30:no-scenecut',
      '-c:a', 'aac',
      '-ar', '48000',
      '-ac', '2',
      '-b:a', '128k',
      '-profile:a', 'aac_low',
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '5',
      '-hls_flags', 'delete_segments+independent_segments',
      '-hls_allow_cache', '0',
      '-hls_segment_type', 'mpegts',
      '-hls_segment_filename', join(this.hlsDir, 'stream%d.ts'),
      join(this.hlsDir, 'stream.m3u8')
    ];

    this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
    this.setupFFmpegHandlers();
  }

  private createStaticSdpFile(sdpPath: string): void {
    const sdpContent = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=Mediasoup HLS Stream
c=IN IP4 127.0.0.1
t=0 0
m=video 5004 RTP/AVP 101
a=rtpmap:101 VP8/90000
a=fmtp:101 max-fr=30;max-fs=8040
a=recvonly
m=audio 5006 RTP/AVP 100
a=rtpmap:100 opus/48000/2
a=fmtp:100 maxplaybackrate=48000;stereo=1;useinbandfec=1
a=recvonly
m=video 5008 RTP/AVP 101
a=rtpmap:101 VP8/90000
a=fmtp:101 max-fr=30;max-fs=8040
a=recvonly
m=audio 5010 RTP/AVP 100
a=rtpmap:100 opus/48000/2
a=fmtp:100 maxplaybackrate=48000;stereo=1;useinbandfec=1
a=recvonly`;

    writeFileSync(sdpPath, sdpContent);
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