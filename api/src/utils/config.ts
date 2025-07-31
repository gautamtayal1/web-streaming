import * as mediasoup from "mediasoup";

export const MEDIASOUP_CONFIG = {
  worker: {
    rtcMinPort: 20000,
    rtcMaxPort: 20200,
    logLevel: "warn" as mediasoup.types.WorkerLogLevel,
    logTags: ["ice", "dtls", "rtp"] as mediasoup.types.WorkerLogTag[]
  },
  webRtcServer: {
    listenInfos: [
      { protocol: "udp" as const, ip: "127.0.0.1", port: 20000 },
      { protocol: "tcp" as const, ip: "127.0.0.1", port: 20001 }
    ]
  },
  router: {
    mediaCodecs: [
      {
        kind: "audio" as const,
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2
      },
      {
        kind: "video" as const,
        mimeType: "video/VP8",
        clockRate: 90000,
        parameters: {},
        rtcpFeedback: [
          { type: "nack" },
          { type: "nack", parameter: "pli" },
          { type: "ccm", parameter: "fir" },
          { type: "goog-remb" }
        ]
      },
      {
        kind: "video" as const,
        mimeType: "video/H264",
        clockRate: 90000,
        parameters: {
          "packetization-mode": 1,
          "profile-level-id": "42e01f",
          "level-asymmetry-allowed": 1
        }
      }
    ] as mediasoup.types.RtpCodecCapability[]
  }
};

export const FFMPEG_CONFIG = {
  video: {
    codec: "libx264",
    preset: "veryfast",
    tune: "zerolatency",
    profile: "baseline",
    level: "3.1",
    pixelFormat: "yuv420p",
    gopSize: 60,
    keyintMin: 60,
    sceneChangeThreshold: 0,
    bitrate: "1000k",
    maxrate: "1200k",
    bufsize: "2000k"
  },
  audio: {
    codec: "aac",
    bitrate: "128k",
    sampleRate: "48000",
    channels: "2"
  },
  hls: {
    time: "1",
    listSize: "5",
    flags: "delete_segments+independent_segments+program_date_time",
    allowCache: "0",
    segmentType: "mpegts"
  }
};

export const SERVER_CONFIG = {
  port: 8080,
  hlsDir: "hls"
};