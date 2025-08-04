"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

const HLS_STREAM_URL = 'http://localhost:8080/hls/stream.m3u8';

export default function WatchPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls>(null);
  const [streamStatus, setStreamStatus] = useState<'loading' | 'ready' | 'playing' | 'error' | 'no-stream'>('loading');
  const [retryCount, setRetryCount] = useState<number>(0);

  const checkStreamAvailability = async (): Promise<boolean> => {
    try {
      const response = await fetch('http://localhost:8080/stream-status', {
        method: 'GET',
        mode: 'cors'
      });
      const data = await response.json();
      console.log('[hls] Stream status check:', data);
      return data.active;
    } catch (error) {
      console.log('[hls] Stream status check failed:', error);
      return false;
    }
  };

  const initPlayer = async () => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    console.log('[hls] Checking if stream is available...');
    const streamAvailable = await checkStreamAvailability();
    
    if (!streamAvailable) {
      console.log('[hls] Stream not available, will retry...');
      setStreamStatus('no-stream');
      if (retryCount < 10) {
        setTimeout(() => {
          setRetryCount(prev => prev + 1);
          initPlayer();
        }, 3000);
      } else {
        setStreamStatus('error');
      }
      return;
    }
    setRetryCount(0);
    setStreamStatus('ready');

    try {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }

      if (Hls.isSupported()) {
        const hls = new Hls({
          lowLatencyMode: true,
        });
        
        hlsRef.current = hls;
        
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setStreamStatus('playing');
          videoElement.play().catch(() => setStreamStatus('ready'));
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            setStreamStatus('error');
            hls.destroy();
            hlsRef.current = null;
          }
        });

        hls.loadSource(HLS_STREAM_URL);
        hls.attachMedia(videoElement);
        
      } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
        videoElement.src = HLS_STREAM_URL;
        videoElement.addEventListener('loadedmetadata', () => {
          setStreamStatus('playing');
          videoElement.play().catch(() => setStreamStatus('ready'));
        });
        videoElement.addEventListener('error', () => setStreamStatus('error'));
      } else {
        setStreamStatus('error');
      }
    } catch (error) {
      setStreamStatus('error');
    }
  };

  const handlePlayClick = () => {
    videoRef.current?.play();
  };

  const handleRetry = () => {
    setStreamStatus('loading');
    setRetryCount(0);
    initPlayer();
  };

  useEffect(() => {
    initPlayer();
    return () => hlsRef.current?.destroy();
  }, []);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col justify-center items-center">
      <h1 className="text-4xl font-bold mb-6 text-white">HLS Live Stream</h1>
      <div className="w-[90vw] h-[75vh] relative">
        <video 
          ref={videoRef}
          controls
          playsInline
          className="w-full h-full object-cover"
          onPlay={() => setStreamStatus('playing')}
          onError={() => setStreamStatus('error')}
        />
        
        {streamStatus !== 'playing' && (
          <div className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center">
            {streamStatus === 'loading' && (
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
            )}
            {streamStatus === 'ready' && (
              <button 
                onClick={handlePlayClick}
                className="rounded-full h-16 w-16 bg-blue-600 hover:bg-blue-700 flex items-center justify-center"
              >
                <span className="text-white text-2xl ml-1">▶</span>
              </button>
            )}
            {streamStatus === 'no-stream' && (
              <div className="text-center">
                <div className="animate-pulse rounded-full h-12 w-12 bg-yellow-500 mx-auto mb-4"></div>
                <p className="text-yellow-400 mb-2">No stream detected. Retrying...</p>
                <p className="text-sm text-gray-400">Make sure someone is streaming first</p>
              </div>
            )}
            {streamStatus === 'error' && (
              <div className="text-center">
                <div className="rounded-full h-12 w-12 bg-red-500 mx-auto flex items-center justify-center mb-4">
                  <span className="text-white font-bold">!</span>
                </div>
                <p className="text-red-400 mb-4">Error loading stream</p>
                <button 
                  onClick={handleRetry}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}