import * as mediasoup from "mediasoup";
import { ChildProcess } from "child_process";

export interface Peer {
  socket: WebSocket;
  sendTransport?: mediasoup.types.WebRtcTransport;
  recvTransport?: mediasoup.types.WebRtcTransport;
  producers: mediasoup.types.Producer[];
  consumers: mediasoup.types.Consumer[];
}

export interface FFmpegStream {
  videoPlainTransport: mediasoup.types.PlainTransport;
  audioPlainTransport: mediasoup.types.PlainTransport;
  videoConsumer?: mediasoup.types.Consumer;
  audioConsumer?: mediasoup.types.Consumer;
  ffmpegProcess?: ChildProcess;
  videoRtpPort: number;
  audioRtpPort: number;
  videoRtcpPort: number;
  audioRtcpPort: number;
}