import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuid } from "uuid";

interface WSMessage {
  type: "join" | "signal" | "ping" | "pong" | "error" | "leave";
  payload?: unknown;
  peerId?: string;
}

const httpServer = http.createServer();
const wss        = new WebSocketServer({ server: httpServer });

type Peer = { id: string; socket: WebSocket };
const peers = new Map<string, Peer>();

wss.on("connection", (socket) => {
  const id = uuid();
  peers.set(id, { id, socket });

  socket.send(JSON.stringify({ type: "welcome", peerId: id }));

  socket.on("message", (data) => {
    let msg: WSMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      socket.send(JSON.stringify({ type: "error", payload: "Bad JSON" }));
      return;
    }

    switch (msg.type) {
      case "join":
        broadcast({ ...msg, peerId: id }, id);
        break;

      case "signal":  
        const targetId = (msg.payload as { to: string }).to;
        const target   = peers.get(targetId);
        if (target)
          target.socket.send(JSON.stringify({ ...msg, peerId: id }));
        break;

      case "ping":
        socket.send(JSON.stringify({ type: "pong" }));
        break;
    }
  });

  socket.on("close", () => {
    peers.delete(id);
    broadcast({ type: "leave", peerId: id });
  });
});

function broadcast(msg: WSMessage, excludeId?: string) {
  const str = JSON.stringify(msg);
  peers.forEach(({ id, socket }) => {
    if (id !== excludeId && socket.readyState === WebSocket.OPEN) socket.send(str);
  });
}

const PORT = 8080;
httpServer.listen(PORT, () => {
  console.log(`WebSocket signaling server listening on ws://localhost:${PORT}`);
});
