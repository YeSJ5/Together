import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { useAudioRoom } from "../context/AudioRoomContext";
import { fetchSession } from "../lib/api";
import { createAppId } from "../lib/ids";
import { normalizeRoomId } from "../lib/sanitize";
import { createSocket } from "../lib/socket";
import { getListenerSession } from "../lib/storage";
import { createPeerConnection, getDynamicIceServers } from "../lib/webrtc";
import {
  disableNativeBackgroundPlayback,
  enableNativeBackgroundPlayback,
  isNativeAndroidApp
} from "../lib/nativeAudio";

export default function LiveSessionPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const normalizedRoomId = normalizeRoomId(roomId);

  const {
    registerActiveSession,
    leaveActiveSession,
    addTranscriptChunk,
    attachStreamToAudio,
    persistentAudioRef
  } = useAudioRoom();

  const [listenerId] = useState(() => createAppId("listener"));
  const [username] = useState(() => {
    const saved = getListenerSession();
    return saved?.username || "Listener";
  });

  const [sessionData, setSessionData] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [endReason, setEndReason] = useState("");
  const [connectionError, setConnectionError] = useState(null);
  const [isVerifying, setIsVerifying] = useState(true);
  const [listenerCount, setListenerCount] = useState(1);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [transcripts, setTranscripts] = useState([]);
  const [captionsVisible, setCaptionsVisible] = useState(true);
  const [liveReactions, setLiveReactions] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);

  const socketRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const chatScrollRef = useRef(null);
  const roomContainerRef = useRef(null);
  const accumulatedHueRef = useRef(150);

  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  useEffect(() => {
    let isCancelled = false;

    // Dynamically resolve ICE servers (STUN + TURN) ahead of time
    getDynamicIceServers().catch(() => {});

    // Verify session initially
    setConnectionError(null);
    setIsVerifying(true);
    fetchSession(normalizedRoomId)
      .then((data) => {
        if (!isCancelled) {
          setSessionData(data);
          setListenerCount((data.users?.length || 0) + 1);
          if (data.currentTrack) setCurrentTrack(data.currentTrack);

          registerActiveSession({
            roomId: normalizedRoomId,
            userRole: "listener",
            title: data.title || `${data.hostName}'s Room`,
            host: data.hostName,
            cat: data.category,
            socket: null,
            cleanup: teardownPlayback
          });

          try {
            const prev = JSON.parse(localStorage.getItem("together-recent-rooms") || "[]");
            const filtered = prev.filter((r) => r.roomId !== normalizedRoomId);
            filtered.unshift({
              roomId: normalizedRoomId,
              title: data.title || `${data.hostName}'s Room`,
              hostName: data.hostName,
              category: data.category || "Music"
            });
            localStorage.setItem("together-recent-rooms", JSON.stringify(filtered.slice(0, 8)));
          } catch (_e) {}
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          if (err.status === 404) {
            setSessionEnded(true);
            setEndReason("This session does not exist or has expired.");
          } else {
            setConnectionError(err.message || "Could not reach session. The server may be starting up.");
          }
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsVerifying(false);
        }
      });

    // Create Socket.IO connection
    const socket = createSocket();
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("listener-joined-room", {
        roomId: normalizedRoomId,
        listenerId,
        username
      });
    });

    socket.on("user-count-updated", (data) => {
      if (data.roomId === normalizedRoomId) {
        setListenerCount(data.count || 1);
      }
    });

    socket.on("signal:offer", async (data) => {
      if (data.targetListenerId && data.targetListenerId !== listenerId) {
        return;
      }

      try {
        if (peerConnectionRef.current) {
          peerConnectionRef.current.close();
        }

        const pc = createPeerConnection({
          onIceCandidate: (candidate) => {
            socket.emit("signal:ice-candidate", {
              roomId: normalizedRoomId,
              targetId: data.senderId,
              candidate,
              senderId: listenerId
            });
          },
          onTrack: (remoteStream) => {
            attachRemoteAudio(remoteStream);
          },
          onConnectionStateChange: (state) => {
            if (state === "connected") {
              setIsConnected(true);
            } else if (state === "disconnected" || state === "failed") {
              setIsConnected(false);
              if (state === "failed" && socketRef.current && socketRef.current.connected) {
                // Request fresh negotiation from host
                socketRef.current.emit("listener-joined-room", {
                  roomId: normalizedRoomId,
                  listenerId,
                  username
                });
              }
            }
          }
        });

        peerConnectionRef.current = pc;
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("signal:answer", {
          roomId: normalizedRoomId,
          targetHostId: data.senderId,
          answer,
          senderId: listenerId
        });
      } catch (_err) {
        // Connection negotiation error
      }
    });

    socket.on("signal:ice-candidate", async (data) => {
      if (data.targetId && data.targetId !== listenerId) {
        return;
      }
      if (peerConnectionRef.current && data.candidate) {
        try {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (_err) {}
      }
    });

    socket.on("chat-message", (msg) => {
      setChatMessages((prev) => [...prev, msg]);
    });

    socket.on("transcript-chunk", (chunk) => {
      addTranscriptChunk(chunk);
      setTranscripts((prev) => [...prev.slice(-15), chunk]);
    });

    socket.on("reaction", (data) => {
      setLiveReactions((prev) => [...prev.slice(-10), data]);
    });

    socket.on("playback-state-updated", (data) => {
      if (data.currentTrack) {
        setCurrentTrack(data.currentTrack);
      }
    });

    socket.on("session-ended", (data) => {
      setSessionEnded(true);
      setEndReason(data.reason || "The host ended the session.");
      teardownPlayback();
    });

    return () => {
      isCancelled = true;
      if (socketRef.current) {
        socketRef.current.emit("listener-left-room", {
          roomId: normalizedRoomId,
          listenerId
        });
        socketRef.current.disconnect();
      }
      teardownPlayback();
    };
  }, [normalizedRoomId, listenerId, username]);

  function configureMediaSession() {
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: sessionData?.hostName ? `${sessionData.hostName}'s Audio Room` : "TOGETHER Live Audio",
          artist: "TOGETHER",
          album: `Room ${normalizedRoomId}`,
          artwork: [
            { src: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
            { src: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml" }
          ]
        });

        navigator.mediaSession.playbackState = "playing";

        navigator.mediaSession.setActionHandler("play", () => {
          if (audioElementRef.current) {
            audioElementRef.current.play();
            setIsPlaying(true);
            if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
          }
        });

        navigator.mediaSession.setActionHandler("pause", () => {
          if (audioElementRef.current) {
            audioElementRef.current.pause();
            setIsPlaying(false);
            if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
          }
        });
      } catch (_err) {}
    }

    if (isNativeAndroidApp()) {
      enableNativeBackgroundPlayback({
        title: sessionData?.hostName ? `${sessionData.hostName}'s Room` : "TOGETHER Live Audio",
        text: `Playing in background (Screen locked)`,
        playing: true
      }).catch(() => {});
    }
  }

  // Ensure playback stays active when screen is locked or tab is hidden
  useEffect(() => {
    const handleResume = () => {
      if (audioContextRef.current && audioContextRef.current.state === "suspended") {
        audioContextRef.current.resume().catch(() => {});
      }
      if (persistentAudioRef.current && isPlaying && persistentAudioRef.current.paused) {
        persistentAudioRef.current.play().catch(() => {});
      }
    };

    document.addEventListener("visibilitychange", handleResume);
    window.addEventListener("focus", handleResume);

    return () => {
      document.removeEventListener("visibilitychange", handleResume);
      window.removeEventListener("focus", handleResume);
    };
  }, [isPlaying]);

  function attachRemoteAudio(stream) {
    setupAudioVisualizer(stream);
    configureMediaSession();

    attachStreamToAudio(stream)
      .then(() => {
        setIsPlaying(true);
        setNeedsGesture(false);
      })
      .catch((err) => {
        if (err && (err.name === "NotAllowedError" || err.name === "AbortError")) {
          setNeedsGesture(true);
        }
      });
  }

  function setupAudioVisualizer(stream) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") {
        ctx.resume();
      }

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateMeter = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        let bassSum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
          if (i < 4) bassSum += dataArray[i];
        }

        const avg = sum / dataArray.length;
        const bass = Math.min(100, Math.round((bassSum / 4 / 128) * 100));
        setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));

        // Dynamic DJ ambient color progression
        if (avg > 3) {
          accumulatedHueRef.current = (accumulatedHueRef.current + 0.8 + (bass > 40 ? 1.5 : 0)) % 360;
        }

        if (roomContainerRef.current) {
          const primaryHue = Math.round(accumulatedHueRef.current);
          const secondaryHue = (primaryHue + 60) % 360;
          const glowAlpha = Math.min(0.65, (avg / 100) * 0.5);
          const bassGlow = Math.min(0.7, (bass / 100) * 0.6);

          roomContainerRef.current.style.setProperty("--dj-color-primary", `hsl(${primaryHue}, 90%, 55%)`);
          roomContainerRef.current.style.setProperty("--dj-color-secondary", `hsl(${secondaryHue}, 95%, 60%)`);
          roomContainerRef.current.style.setProperty("--dj-border-glow", `hsla(${primaryHue}, 90%, 55%, ${0.2 + glowAlpha})`);
          roomContainerRef.current.style.setProperty("--dj-shadow-glow", `0 16px 45px rgba(0,0,0,0.7), 0 0 ${20 + bass * 0.5}px hsla(${primaryHue}, 90%, 55%, ${0.15 + bassGlow})`);
          roomContainerRef.current.style.setProperty("--dj-disc-speed", `${Math.max(1.8, 6 - (avg / 100) * 4.2)}s`);
        }

        animFrameRef.current = requestAnimationFrame(updateMeter);
      };
      updateMeter();
    } catch (_err) {}
  }

  function teardownPlayback() {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (persistentAudioRef.current) {
      persistentAudioRef.current.pause();
      persistentAudioRef.current.srcObject = null;
    }
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.playbackState = "none";
      } catch (_err) {}
    }
    if (isNativeAndroidApp()) {
      disableNativeBackgroundPlayback().catch(() => {});
    }
    leaveActiveSession();
    setIsConnected(false);
    setIsPlaying(false);
  }

  function handleSendReaction(emoji) {
    if (!socketRef.current) return;
    const reaction = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      roomId: normalizedRoomId,
      emoji,
      senderName: username
    };
    socketRef.current.emit("reaction", reaction);
    setLiveReactions((prev) => [...prev.slice(-10), reaction]);
  }

  function handleManualPlay() {
    if (persistentAudioRef.current) {
      persistentAudioRef.current.play()
        .then(() => {
          setIsPlaying(true);
          setNeedsGesture(false);
          configureMediaSession();
          if (persistentAudioRef.current.srcObject) {
            setupAudioVisualizer(persistentAudioRef.current.srcObject);
          }
        })
        .catch(() => {});
    }
  }

  function handleVolumeChange(e) {
    const val = parseFloat(e.target.value);
    setVolume(val);
    setIsMuted(false);
    if (persistentAudioRef.current) {
      persistentAudioRef.current.volume = val;
    }
  }

  function toggleMute() {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (persistentAudioRef.current) {
      persistentAudioRef.current.volume = nextMuted ? 0 : volume;
    }
  }

  function handleSendChat(e) {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || !socketRef.current) return;

    socketRef.current.emit("chat-message", {
      roomId: normalizedRoomId,
      senderId: listenerId,
      senderName: username,
      message: text
    });
    setChatInput("");
  }

  function handleLeave() {
    teardownPlayback();
    navigate("/");
  }

  return (
    <AppShell>
      <audio ref={audioElementRef} autoPlay playsInline style={{ display: "none" }} />
      <div style={{ maxWidth: "980px", margin: "24px auto 0" }}>
        {sessionEnded ? (
          <div className="content-card fade-in" style={{ padding: "48px 32px", textAlign: "center", maxWidth: "500px", margin: "60px auto" }}>
            <span style={{ fontSize: "3rem", display: "block", marginBottom: "12px" }}>🛑</span>
            <h2 style={{ fontSize: "1.6rem", margin: "0 0 8px" }}>Session Ended</h2>
            <p className="subtle-text" style={{ marginBottom: "24px" }}>{endReason}</p>
            <Link to="/" className="button-primary" style={{ display: "inline-block", textDecoration: "none" }}>
              Return to Home
            </Link>
          </div>
        ) : connectionError && !sessionData ? (
          <div className="content-card fade-in" style={{ padding: "48px 32px", textAlign: "center", maxWidth: "520px", margin: "60px auto" }}>
            <span style={{ fontSize: "3rem", display: "block", marginBottom: "12px" }}>📡</span>
            <h2 style={{ fontSize: "1.5rem", margin: "0 0 8px", color: "var(--accent-rose)" }}>Connection Timeout</h2>
            <p className="subtle-text" style={{ marginBottom: "24px" }}>
              {connectionError} If the server was sleeping, it will be ready in a few moments.
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              <button
                type="button"
                className="button-primary"
                onClick={() => {
                  setConnectionError(null);
                  setIsVerifying(true);
                  fetchSession(normalizedRoomId)
                    .then((data) => {
                      setSessionData(data);
                      setListenerCount((data.users?.length || 0) + 1);
                      if (data.currentTrack) setCurrentTrack(data.currentTrack);
                    })
                    .catch((err) => {
                      setConnectionError(err.message || "Failed to reach session.");
                    })
                    .finally(() => setIsVerifying(false));
                }}
              >
                🔄 Retry Connection
              </button>
              <Link to="/" className="button-secondary" style={{ textDecoration: "none" }}>
                Return to Home
              </Link>
            </div>
          </div>
        ) : isVerifying && !sessionData ? (
          <div style={{ textAlign: "center", padding: "80px 20px" }}>
            <div className="spinner-disc" />
            <p className="subtle-text" style={{ marginTop: "16px" }}>Connecting to audio broadcast stage...</p>
          </div>
        ) : (
          <div ref={roomContainerRef} style={{ position: "relative" }}>
            {/* DJ Reactive Ambient Stage Light Orbs */}
            <div className="dj-ambient-stage">
              <div className="dj-orb-1" />
              <div className="dj-orb-2" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "24px" }}>
              {/* Player Column */}
              <div className="content-card dj-reactive-card" style={{ padding: "28px" }}>
                {/* Header Info */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      <span className="live-pill" style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        background: isConnected ? "rgba(46, 204, 113, 0.15)" : "rgba(243, 156, 18, 0.15)",
                        color: isConnected ? "#27ae60" : "#d35400",
                        padding: "4px 10px",
                        borderRadius: "999px",
                        fontSize: "0.82rem",
                        fontWeight: 700
                      }}>
                        <span style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          background: isConnected ? "#2ecc71" : "#f39c12"
                        }} />
                        {isConnected ? "LIVE AUDIO" : "CONNECTING..."}
                      </span>
                      <span className="subtle-text" style={{ fontSize: "0.85rem" }}>
                        {normalizedRoomId}
                      </span>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: "999px",
                          background: "rgba(6, 182, 212, 0.15)",
                          color: "var(--accent-cyan)"
                        }}
                      >
                        {sessionData?.category || "Music"}
                      </span>
                    </div>
                    <h1 style={{ fontSize: "1.35rem", margin: "4px 0 0", fontWeight: 800 }}>
                      {sessionData?.title || (sessionData?.hostName ? `${sessionData.hostName}'s Room` : "Live Broadcast")}
                    </h1>
                    <span className="subtle-text" style={{ fontSize: "0.84rem" }}>
                      Hosted by {sessionData?.hostName || "Host"}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <button
                      type="button"
                      className={`button-secondary ${captionsVisible ? "active-pill" : ""}`}
                      onClick={() => setCaptionsVisible(!captionsVisible)}
                      title="Toggle live speech-to-text subtitles"
                      style={{ fontSize: "0.82rem", padding: "6px 12px" }}
                    >
                      {captionsVisible ? "🎙️ [CC] ON" : "🎙️ [CC] OFF"}
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={handleLeave}
                      style={{ fontSize: "0.85rem", padding: "6px 12px", color: "var(--accent-rose)" }}
                    >
                      Leave
                    </button>
                  </div>
                </div>

                {/* Synchronized Now Playing Pill */}
                {currentTrack?.title && (
                  <div
                    className="fade-in"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      background: "rgba(16, 185, 129, 0.1)",
                      border: "1px solid rgba(16, 185, 129, 0.25)",
                      padding: "8px 14px",
                      borderRadius: "var(--radius-control)",
                      marginBottom: "16px",
                      fontSize: "0.86rem"
                    }}
                  >
                    <span>🎵</span>
                    <div>
                      <strong style={{ color: "var(--text-main)" }}>Now Playing:</strong>{" "}
                      <span>{currentTrack.title}</span>
                      {currentTrack.artist && <span className="subtle-text"> • {currentTrack.artist}</span>}
                    </div>
                  </div>
                )}

                {/* Autoplay Unlock Banner */}
                {needsGesture && (
                  <div style={{
                    background: "rgba(255, 140, 66, 0.12)",
                    border: "1px solid rgba(255, 140, 66, 0.4)",
                    padding: "16px",
                    borderRadius: "14px",
                    textAlign: "center",
                    marginBottom: "20px"
                  }}>
                    <p style={{ margin: "0 0 10px", fontSize: "0.95rem", fontWeight: 600 }}>
                      Tap below to start listening to the audio stream:
                    </p>
                    <button
                      type="button"
                      className="button-primary"
                      onClick={handleManualPlay}
                      style={{ justifyContent: "center", width: "100%", padding: "12px" }}
                    >
                      ▶️ Tap to Start Audio
                    </button>
                  </div>
                )}

                {/* Music Streaming Visualizer & DJ Turntable */}
                <div style={{
                  background: "rgba(0, 0, 0, 0.3)",
                  border: "1px solid var(--border-subtle)",
                  padding: "24px 16px",
                  borderRadius: "18px",
                  textAlign: "center",
                  marginBottom: "24px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "14px"
                }}>
                  {/* DJ Spinning Vinyl Turntable with Audio-Reactive Light Rings */}
                  <div style={{ position: "relative" }}>
                    <div className="dj-turntable-wrapper">
                      <div className="dj-light-ring-outer" />
                      <div className="dj-light-ring-inner" />
                      <div className="dj-vinyl-disc">
                        <div className="dj-disc-center-label" />
                      </div>
                    </div>

                    {/* Floating Reaction Emojis */}
                    {liveReactions.length > 0 && (
                      <div style={{
                        position: "absolute",
                        top: "-15px",
                        right: "-20px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        pointerEvents: "none"
                      }}>
                        {liveReactions.slice(-3).map((r) => (
                          <div
                            key={r.id}
                            className="fade-in"
                            style={{
                              background: "rgba(0,0,0,0.75)",
                              border: "1px solid var(--border-accent)",
                              borderRadius: "999px",
                              padding: "4px 10px",
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                              boxShadow: "0 4px 15px rgba(0,0,0,0.5)"
                            }}
                          >
                            <span style={{ fontSize: "1.2rem" }}>{r.emoji}</span>
                            <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-main)" }}>
                              {r.senderName}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Animated EQ Bars */}
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "4px",
                    height: "44px"
                  }}>
                    {[0.5, 0.9, 1.3, 1.7, 1.2, 0.8, 1.5, 0.6, 1.1, 1.6, 0.7, 1.4].map((mult, i) => {
                      const h = isPlaying ? Math.max(6, Math.min(44, Math.round(audioLevel * mult * 0.45))) : 6;
                      return (
                        <div
                          key={i}
                          style={{
                            width: "5px",
                            height: `${h}px`,
                            borderRadius: "3px",
                            background: isPlaying && audioLevel > 5 ? "var(--accent-primary)" : "rgba(255, 255, 255, 0.15)",
                            boxShadow: isPlaying && audioLevel > 5 ? "0 0 10px var(--accent-primary-glow)" : "none",
                            transition: "height 0.08s ease"
                          }}
                        />
                      );
                    })}
                  </div>

                  <span className="subtle-text" style={{ fontSize: "0.82rem", fontWeight: 600 }}>
                    {isPlaying ? (audioLevel > 5 ? "STREAMING • LOSSLESS 48KHZ STEREO" : "CONNECTED • AUDIO SOURCE QUIET") : "CONNECTING TO BROADCAST..."}
                  </span>

                  {/* Live Speech-to-Text Subtitles & Transcripts Drawer */}
                  {captionsVisible && transcripts.length > 0 && (
                    <div
                      className="fade-in"
                      style={{
                        width: "100%",
                        background: "rgba(0, 0, 0, 0.5)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "var(--radius-control)",
                        padding: "10px 14px",
                        textAlign: "left",
                        fontSize: "0.86rem",
                        color: "var(--accent-cyan)",
                        lineHeight: 1.5,
                        boxShadow: "inset 0 2px 8px rgba(0,0,0,0.4)"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px", fontSize: "0.74rem", fontWeight: 700, color: "var(--text-secondary)" }}>
                        <span>🎙️ LIVE CAPTIONS:</span>
                      </div>
                      <p style={{ margin: 0 }}>
                        "{transcripts[transcripts.length - 1].text}"
                      </p>
                    </div>
                  )}

                  {/* Quick Audience Reactions Bar */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                    <span className="subtle-text" style={{ fontSize: "0.8rem", fontWeight: 600 }}>React:</span>
                    {["👏", "🔥", "❤️", "🎉", "⚡"].map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => handleSendReaction(emoji)}
                        title={`Send ${emoji} reaction`}
                        className="button-secondary"
                        style={{
                          padding: "6px 12px",
                          fontSize: "1.1rem",
                          borderRadius: "999px",
                          background: "rgba(255,255,255,0.06)"
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>

              {/* Volume Slider & Controls */}
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="field-label" style={{ margin: 0 }}>Volume</span>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={toggleMute}
                    style={{ padding: "4px 10px", fontSize: "0.82rem" }}
                  >
                    {isMuted ? "🔇 Unmute" : "🔊 Mute"}
                  </button>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  style={{ width: "100%", accentColor: "#ff8c42", cursor: "pointer" }}
                />
              </div>

              {/* Stats Bar */}
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "12px 16px",
                background: "rgba(0,0,0,0.02)",
                borderRadius: "12px",
                fontSize: "0.85rem"
              }}>
                <span className="subtle-text">Connected as: <strong>{username}</strong></span>
                <span className="subtle-text">👥 Listeners: <strong>{listenerCount}</strong></span>
              </div>
            </div>

            {/* Chat Column */}
            <div className="content-card dj-reactive-card" style={{ padding: "24px", display: "flex", flexDirection: "column", height: "520px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", borderBottom: "1px solid rgba(0,0,0,0.06)", paddingBottom: "10px" }}>
                <h3 style={{ margin: 0, fontSize: "1.1rem" }}>💬 Room Chat</h3>
                <span className="subtle-text" style={{ fontSize: "0.82rem" }}>Live discussion</span>
              </div>

              {/* Messages list */}
              <div
                ref={chatScrollRef}
                style={{
                  flex: 1,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  paddingRight: "6px",
                  marginBottom: "16px"
                }}
              >
                {chatMessages.length === 0 ? (
                  <p className="subtle-text" style={{ textAlign: "center", margin: "auto", fontSize: "0.88rem" }}>
                    No messages yet. Say hello to the room!
                  </p>
                ) : (
                  chatMessages.map((msg) => {
                    const isMe = msg.senderId === listenerId;
                    return (
                      <div
                        key={msg.id}
                        style={{
                          alignSelf: isMe ? "flex-end" : "flex-start",
                          maxWidth: "80%",
                          background: isMe ? "#ff8c42" : "rgba(0, 0, 0, 0.06)",
                          color: isMe ? "#fff" : "inherit",
                          padding: "8px 14px",
                          borderRadius: "14px",
                          fontSize: "0.9rem"
                        }}
                      >
                        <span style={{
                          display: "block",
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          opacity: 0.8,
                          marginBottom: "2px"
                        }}>
                          {msg.senderName}
                        </span>
                        <p style={{ margin: 0, wordBreak: "break-word" }}>{msg.message}</p>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Chat Input */}
              <form onSubmit={handleSendChat} style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  placeholder="Send a message..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  maxLength={200}
                  className="text-input"
                  style={{ flex: 1, padding: "10px 14px", fontSize: "0.9rem" }}
                />
                <button type="submit" className="button-primary" style={{ padding: "0 18px", fontSize: "0.9rem" }}>
                  Send
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  </AppShell>
);
}
