"use client";

import { useSignalSocket } from "@/hooks/useSignalSocket";
import { useCallback, useRef, useState, useEffect } from "react";

export default function StreamPage() {
  const [log, setLog] = useState<string[]>([]);
  const addLog = (l: string) => setLog((prev) => [...prev, l]);

  const { connected, send } = useSignalSocket(
    useCallback((msg) => addLog(JSON.stringify(msg)), [])
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((s) => (videoRef.current!.srcObject = s));
  }, []);

  return (
    <main className="p-6 space-y-4 text-neutral-100 bg-neutral-900 min-h-screen">
      <video
        ref={videoRef}
        muted
        autoPlay
        playsInline
        className="w-full max-w-md rounded"
      />

      <pre className="bg-neutral-800 p-3 rounded max-h-60 overflow-auto text-xs">
        {log.join("\n")}
      </pre>
    </main>
  );
}
