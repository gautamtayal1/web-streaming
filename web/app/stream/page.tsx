"use client";

import { useEffect, useRef, useState } from "react";

export default function StreamPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError]   = useState<string | null>(null);
  const [media, setMedia]   = useState<MediaStream | null>(null);

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: { width: 1280, height: 720 }, audio: true })
      .then((stream) => {
        setMedia(stream);
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch((err) => {
        console.error("getUserMedia()", err);
        setError("Could not access camera / microphone");
      });

    return () => {
      media?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-neutral-900 text-neutral-100">
      <h1 className="text-2xl font-semibold mb-4">Local Preview</h1>
      {error && (
        <p className="mb-3 text-red-400 text-sm">
          {error}
        </p>
      )}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full max-w-xl rounded-xl border border-neutral-700 shadow-lg"
      />
    </main>
  );
}
