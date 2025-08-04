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

  async startWithStaticSDP(): Promise<void> {
    if (this.ffmpegProcess) {
      console.log('[ffmpeg] FFmpeg already running, stopping first...');
      await this.stopFFmpegGracefully();
    }

    console.log('[ffmpeg] Starting FFmpeg with static SDP configuration');
    this.startStaticFFmpeg();
  }

  private startStaticFFmpeg(): void {
    const staticSdpPath = join(this.hlsDir, 'stream.sdp');
    
    // Create static SDP file with pre-allocated ports
    this.createStaticSdpFile(staticSdpPath);

    const ffmpegArgs: string[] = [];

    ffmpegArgs.push('-protocol_whitelist', 'file,udp,rtp');
    ffmpegArgs.push('-fflags', '+genpts+discardcorrupt+igndts+flush_packets');
    ffmpegArgs.push('-analyzeduration', '500000');   
    ffmpegArgs.push('-probesize', '500000');         
    ffmpegArgs.push('-max_delay', '50000');          
    ffmpegArgs.push('-buffer_size', '16384');        
    ffmpegArgs.push('-thread_queue_size', '512');    
    ffmpegArgs.push('-avoid_negative_ts', 'make_zero');
    ffmpegArgs.push('-reorder_queue_size', '0');     
    ffmpegArgs.push('-rtbufsize', '16M');            
    ffmpegArgs.push('-use_wallclock_as_timestamps', '1');

    // Input with framerate constraints
    ffmpegArgs.push('-i', staticSdpPath);
    ffmpegArgs.push('-r', '30');  // Higher framerate for better quality

    // Higher quality filter complex for 2-person video
    ffmpegArgs.push('-filter_complex',
      // Increased resolution for better quality
      '[0:0]scale=640:480:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=640:480:(ow-iw)/2:(oh-ih)/2,fps=30[v0]; ' +
      '[0:2]scale=640:480:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=640:480:(ow-iw)/2:(oh-ih)/2,fps=30[v1]; ' +
      '[v0][v1]hstack=inputs=2[v]; ' +
      '[0:1][0:3]amerge=inputs=2,aresample=48000[a]'
    );
    // Mapping - map the filter outputs
    ffmpegArgs.push('-map', '[v]');
    ffmpegArgs.push('-map', '[a]');
    // High quality video codec settings
    ffmpegArgs.push('-c:v', 'libx264');
    ffmpegArgs.push('-preset', 'medium');     // Better quality preset
    ffmpegArgs.push('-tune', 'zerolatency');
    ffmpegArgs.push('-pix_fmt', 'yuv420p');
    ffmpegArgs.push('-g', '30');              // Match framerate
    ffmpegArgs.push('-sc_threshold', '0');
    ffmpegArgs.push('-bf', '2');              // Allow B-frames for better compression
    ffmpegArgs.push('-refs', '3');            // More reference frames for better quality
    ffmpegArgs.push('-crf', '23');            // Lower CRF for better quality
    ffmpegArgs.push('-maxrate', '2000k');     // Higher bitrate for better quality
    ffmpegArgs.push('-bufsize', '4000k');     // Larger buffer size
    ffmpegArgs.push('-threads', '4');         // Increase threads for better performance
    ffmpegArgs.push('-x264opts', 'keyint=30:min-keyint=30:no-scenecut');

    // Higher quality audio codec settings
    ffmpegArgs.push('-c:a', 'aac');
    ffmpegArgs.push('-ar', '48000');         // Higher sample rate
    ffmpegArgs.push('-ac', '2');
    ffmpegArgs.push('-b:a', '128k');         // Higher audio bitrate for better quality
    ffmpegArgs.push('-profile:a', 'aac_low');
    // Fixed HLS settings for proper segment deletion
    ffmpegArgs.push('-f', 'hls');
    ffmpegArgs.push('-hls_time', '2');               // Back to 2 seconds for stability
    ffmpegArgs.push('-hls_list_size', '5');
    ffmpegArgs.push('-hls_flags', 'delete_segments+independent_segments');
    ffmpegArgs.push('-hls_allow_cache', '0');
    ffmpegArgs.push('-hls_segment_type', 'mpegts');
    // Removed hls_playlist_type event - this prevents deletion
    ffmpegArgs.push('-hls_segment_filename', join(this.hlsDir, 'stream%d.ts'));
    ffmpegArgs.push(join(this.hlsDir, 'stream.m3u8'));

    console.log(`[ffmpeg] Static SDP command: ffmpeg ${ffmpegArgs.join(' ')}`);
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
    console.log(`[ffmpeg] Created static SDP file: ${sdpPath}`);
  }

  // Legacy method for backward compatibility - now throws error
  async startFFmpegWithParams(_videoPort: number, _audioPort: number, _rtpParams: any): Promise<ChildProcess> {
    throw new Error("Use startWithStaticSDP instead - dynamic port allocation has been replaced with pre-allocation");
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