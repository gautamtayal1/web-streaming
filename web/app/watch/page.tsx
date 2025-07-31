"use client";
import React, { useEffect, useRef, useState } from "react";

export default function WatchPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    // Check if there's an active stream by trying to load it
    checkForActiveStream();
  }, []);

  const checkForActiveStream = async () => {
    try {
      const response = await fetch("http://localhost:8080/health");
      if (response.ok) {
        // Try to load the HLS stream directly
        await loadHLSStream("http://localhost:8080/hls/stream.m3u8");
      }
    } catch (error) {
      console.log("No active stream found");
    }
  };

  const startWatching = async () => {
    setIsLoading(true);
    setError("");
    
    try {
      // Just try to load the HLS stream - the server creates it automatically when producers exist
      await loadHLSStream("http://localhost:8080/hls/stream.m3u8");
      setIsStreaming(true);
    } catch (error) {
      setError("No active stream found. Make sure someone is streaming first.");
    } finally {
      setIsLoading(false);
    }
  };

  const loadHLSStream = async (hlsUrl: string) => {
    if (!videoRef.current) return;

    // Check if HLS.js is supported
    if (typeof window !== "undefined") {
      const Hls = (await import("hls.js")).default;
      
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: false,
          lowLatencyMode: true,
          backBufferLength: 90,
          // Add retry logic for live streams
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 10
        });
        
        hls.loadSource(hlsUrl);
        hls.attachMedia(videoRef.current);
        
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          console.log("HLS manifest loaded");
          videoRef.current?.play().catch(console.error);
        });
        
        hls.on(Hls.Events.ERROR, (_, data) => {
          console.error("HLS error:", data);
          if (data.fatal) {
            setError(`Stream error: ${data.type}`);
            setIsStreaming(false);
          }
        });

        // Handle when stream becomes available
        hls.on(Hls.Events.FRAG_LOADED, () => {
          if (!isStreaming) {
            setIsStreaming(true);
            setError("");
          }
        });
        
      } else if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
        // Native HLS support (Safari)
        videoRef.current.src = hlsUrl;
        videoRef.current.play()
          .then(() => {
            setIsStreaming(true);
            setError("");
          })
          .catch((error) => {
            setError("Failed to play stream: " + error.message);
          });
      } else {
        setError("HLS is not supported in this browser");
      }
    }
  };

  return (
    <div className="p-4 space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Watch Live Stream</h1>
        <p className="text-gray-600 mb-4">
          Watch the live stream from active users. The stream will appear automatically when someone starts streaming.
        </p>
      </div>

      <div className="flex gap-4 justify-center">
        <button
          onClick={startWatching}
          disabled={isLoading}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {isLoading ? "Connecting..." : "Start Watching"}
        </button>
        
        <button
          onClick={checkForActiveStream}
          className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
        >
          Check for Stream
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded text-center">
          {error}
        </div>
      )}

      {isStreaming && (
        <div className="p-3 bg-green-100 border border-green-400 text-green-700 rounded text-center">
           Live stream is active
        </div>
      )}

      <div className="flex justify-center">
        <div className="relative">
          <video
            ref={videoRef}
            controls
            autoPlay
            muted
            playsInline
            className="w-full max-w-4xl border-4 border-purple-500 bg-gray-200"
            style={{ aspectRatio: "16/9" }}
          />
          {!isStreaming && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100 border-4 border-purple-500">
              <div className="text-center">
                <p className="text-gray-500 text-lg mb-2">
                  No live stream available
                </p>
                <p className="text-gray-400 text-sm">
                  Click "Start Watching" to check for active streams
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="text-center text-sm text-gray-600">
        <p>Stream URL: http://localhost:8080/hls/stream.m3u8</p>
        <p>This page automatically detects when streaming starts</p>
      </div>
    </div>
  );
}