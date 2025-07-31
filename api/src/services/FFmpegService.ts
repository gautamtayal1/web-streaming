import { spawn, ChildProcess } from "child_process";
import { join } from "path";
import { writeFileSync } from "fs";
import { FFmpegStream } from "../types";
import { FFMPEG_CONFIG, SERVER_CONFIG } from "../config";

export class FFmpegService {
  private hlsDir: string;

  constructor() {
    this.hlsDir = join(process.cwd(), SERVER_CONFIG.hlsDir);
  }

  createSDPFile(streamId: string, stream: FFmpegStream): string {
    let sdpContent = "v=0\n";
    sdpContent += "o=mediasoup 0 0 IN IP4 127.0.0.1\n";
    sdpContent += "s=MediaSoup FFmpeg Stream\n";
    sdpContent += "c=IN IP4 127.0.0.1\n";
    sdpContent += "t=0 0\n";
    
    if (stream.videoConsumer) {
      const videoCodec = stream.videoConsumer.rtpParameters.codecs[0];
      sdpContent += `m=video ${stream.videoRtpPort} RTP/AVP ${videoCodec.payloadType}\n`;
      sdpContent += `a=rtpmap:${videoCodec.payloadType} ${videoCodec.mimeType.split('/')[1]}/${videoCodec.clockRate}\n`;
      
      if (stream.videoRtcpPort !== stream.videoRtpPort + 1) {
        sdpContent += `a=rtcp:${stream.videoRtcpPort}\n`;
      }
      
      if (videoCodec.parameters) {
        const fmtp = Object.entries(videoCodec.parameters)
          .map(([k, v]) => `${k}=${v}`)
          .join(';');
        if (fmtp) sdpContent += `a=fmtp:${videoCodec.payloadType} ${fmtp}\n`;
      }
      sdpContent += "a=recvonly\n";
    }
    
    if (stream.audioConsumer) {
      const audioCodec = stream.audioConsumer.rtpParameters.codecs[0];
      sdpContent += `m=audio ${stream.audioRtpPort} RTP/AVP ${audioCodec.payloadType}\n`;
      sdpContent += `a=rtpmap:${audioCodec.payloadType} ${audioCodec.mimeType.split('/')[1]}/${audioCodec.clockRate}`;
      if (audioCodec.channels) sdpContent += `/${audioCodec.channels}`;
      sdpContent += "\n";
      
      if (stream.audioRtcpPort !== stream.audioRtpPort + 1) {
        sdpContent += `a=rtcp:${stream.audioRtcpPort}\n`;
      }
      sdpContent += "a=recvonly\n";
    }
    
    const sdpPath = join(this.hlsDir, `${streamId}.sdp`);
    writeFileSync(sdpPath, sdpContent);
    return sdpPath;
  }

  async startFFmpegProcess(streamId: string, stream: FFmpegStream): Promise<ChildProcess> {
    const outputPath = join(this.hlsDir, `${streamId}.m3u8`);
    const sdpPath = this.createSDPFile(streamId, stream);
    
    const args = this.buildFFmpegArgs(sdpPath, stream, outputPath);
    const ffmpeg = spawn("ffmpeg", args);
    
    this.setupFFmpegEventHandlers(ffmpeg);
    return ffmpeg;
  }

  private buildFFmpegArgs(sdpPath: string, stream: FFmpegStream, outputPath: string): string[] {
    const args = [
      "-y",
      "-protocol_whitelist", "file,rtp,udp,rtcp",
      "-re",
      "-f", "sdp",
      "-i", sdpPath
    ];

    // Stream mapping
    if (stream.videoConsumer && stream.audioConsumer) {
      args.push("-map", "0:v", "-map", "0:a");
    } else if (stream.videoConsumer) {
      args.push("-map", "0:v", "-an");
    } else {
      args.push("-map", "0:a", "-vn");
    }

    // Video encoding
    if (stream.videoConsumer) {
      args.push(
        "-c:v", FFMPEG_CONFIG.video.codec,
        "-preset", FFMPEG_CONFIG.video.preset,
        "-tune", FFMPEG_CONFIG.video.tune,
        "-profile:v", FFMPEG_CONFIG.video.profile,
        "-level", FFMPEG_CONFIG.video.level,
        "-pix_fmt", FFMPEG_CONFIG.video.pixelFormat,
        "-g", FFMPEG_CONFIG.video.gopSize.toString(),
        "-keyint_min", FFMPEG_CONFIG.video.keyintMin.toString(),
        "-sc_threshold", FFMPEG_CONFIG.video.sceneChangeThreshold.toString(),
        "-b:v", FFMPEG_CONFIG.video.bitrate,
        "-maxrate", FFMPEG_CONFIG.video.maxrate,
        "-bufsize", FFMPEG_CONFIG.video.bufsize
      );
    }

    // Audio encoding
    if (stream.audioConsumer) {
      args.push(
        "-c:a", FFMPEG_CONFIG.audio.codec,
        "-b:a", FFMPEG_CONFIG.audio.bitrate,
        "-ar", FFMPEG_CONFIG.audio.sampleRate,
        "-ac", FFMPEG_CONFIG.audio.channels
      );
    }

    // HLS output
    args.push(
      "-f", "hls",
      "-hls_time", FFMPEG_CONFIG.hls.time,
      "-hls_list_size", FFMPEG_CONFIG.hls.listSize,
      "-hls_flags", FFMPEG_CONFIG.hls.flags,
      "-hls_allow_cache", FFMPEG_CONFIG.hls.allowCache,
      "-hls_segment_type", FFMPEG_CONFIG.hls.segmentType,
      outputPath
    );

    return args;
  }

  private setupFFmpegEventHandlers(ffmpeg: ChildProcess): void {
    ffmpeg.stdout?.on("data", (data) => console.log(`FFmpeg stdout: ${data}`));
    ffmpeg.stderr?.on("data", (data) => console.log(`FFmpeg stderr: ${data}`));
    ffmpeg.on("close", (code) => console.log(`FFmpeg process closed with code ${code}`));
    ffmpeg.on("error", (error) => console.error("FFmpeg process error:", error));
  }
}