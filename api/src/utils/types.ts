import * as mediasoup from "mediasoup";
import { ChildProcess } from "child_process";
import { WebSocket } from "ws";

export interface Peer {
  socket: WebSocket;
  sendTransport?: mediasoup.types.WebRtcTransport;
  recvTransport?: mediasoup.types.WebRtcTransport;
  producers: mediasoup.types.Producer[];
  consumers: mediasoup.types.Consumer[];
}

export type WSMessage =
  | { type: "createSendTransport" }
  | { type: "createRecvTransport" }
  | { type: "connectSendTransport", data: mediasoup.types.DtlsParameters }
  | { type: "connectRecvTransport", data: mediasoup.types.DtlsParameters }
  | { type: "produce", data: { kind: "audio" | "video", rtpParameters: mediasoup.types.RtpParameters } }
  | { type: "consume", data: { producerId: string, rtpCapabilities: mediasoup.types.RtpCapabilities } }
  | { type: "routerRtpCapabilities", data: mediasoup.types.RtpCapabilities }
  | { type: "sendTransportCreated", data: { id: string, iceParameters: mediasoup.types.IceParameters, iceCandidates: mediasoup.types.IceCandidate[], dtlsParameters: mediasoup.types.DtlsParameters } }
  | { type: "recvTransportCreated", data: { id: string, iceParameters: mediasoup.types.IceParameters, iceCandidates: mediasoup.types.IceCandidate[], dtlsParameters: mediasoup.types.DtlsParameters } }
  | { type: "produced", data: { producerId: string } }
  | { type: "consumed", data: { producerId: string, id: string, kind: mediasoup.types.MediaKind, rtpParameters: mediasoup.types.RtpParameters } }
  | { type: "newProducer", data: { producerId: string, kind: mediasoup.types.MediaKind } }
  | { type: "cannotConsume" };

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