import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import QRCode from "react-qr-code";
import AppShell from "../components/AppShell";
import { createSession, endSession } from "../lib/api";
import { createAppId } from "../lib/ids";
import { sanitizeDisplayName } from "../lib/sanitize";
import { createSocket } from "../lib/socket";
import { captureHostAudio, createPeerConnection } from "../lib/webrtc";
import {
  disableNativeBackgroundPlayback,
  enableNativeBackgroundPlayback,
  isNativeAndroidApp,
  startNativeSystemAudioBridge
} from "../lib/nativeAudio";

export default function HostDashboardPage() {
  const [searchParams] = useSearchParams();
  const initialName = searchParams.get("name") || "";
  const initialSource = searchParams.get("source") || "microphone";

  const [hostName, setHostName] = useState(initialName || "Host");
  const [audioSourceMode, setAudioSourceMode] = useState(initialSource);
  const [selectedFile, setSelectedFile] = useState(null);

  const [session, setSession] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // Stats & Chat
  const [connectedUsers, setConnectedUsers] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);

  // File audio playback state
  const [isFilePlaying, setIsFilePlaying] = useState(false);
  const [fileProgress, setFileProgress] = useState(0);
  const [fileDuration, setFileDuration] = useState(0);

  // Network origin for QR code
  const [networkOrigin, setNetworkOrigin] = useState(window.location.origin);

  // References
  const hostIdRef = useRef(createAppId("host"));
  const socketRef = useRef(null);
  const streamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const fileAudioRef = useRef(null);
  const fileObjectUrlRef = useRef(null);
  const nativeBridgeRef = useRef(null);
  const chatScrollRef = useRef(null);
  const bgAudioRef = useRef(null);

  // Fetch runtime LAN origin for mobile QR compatibility
  useEffect(() => {
    fetch("/api/runtime")
      .then((res) => res.json())
      .then((data) => {
        if (data.lanOrigin && window.location.hostname === "localhost") {
          setNetworkOrigin(data.lanOrigin);
        } else {
          setNetworkOrigin(data.currentOrigin || window.location.origin);
        }
      })
      .catch(() => {});
  }, []);

  const joinUrl = useMemo(() => {
    if (!session?.roomId) return "";
    return `${networkOrigin}/join/${session.roomId}`;
  }, [session, networkOrigin]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Audio level visualizer loop
  function setupVisualizer(stream) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

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
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(updateMeter);
      };
      updateMeter();
    } catch (_err) {}
  }

  // Handle local audio file streaming
  async function setupAudioFileStream(file) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      throw new Error("Local audio file streaming is not supported on this browser.");
    }

    const objectUrl = URL.createObjectURL(file);
    fileObjectUrlRef.current = objectUrl;

    const audio = new Audio();
    audio.src = objectUrl;
    audio.preload = "auto";
    audio.playsInline = true;
    fileAudioRef.current = audio;

    await new Promise((resolve, reject) => {
      audio.onloadedmetadata = () => {
        setFileDuration(audio.duration || 0);
        resolve();
      };
      audio.onerror = () => reject(new Error("Could not load the chosen audio file."));
    });

    const ctx = new AudioCtx();
    audioContextRef.current = ctx;
    const sourceNode = ctx.createMediaElementSource(audio);
    const destNode = ctx.createMediaStreamDestination();

    // Route to WebRTC stream AND to host local speakers
    sourceNode.connect(destNode);
    sourceNode.connect(ctx.destination);

    audio.ontimeupdate = () => {
      if (audio.duration) {
        setFileProgress((audio.currentTime / audio.duration) * 100);
      }
    };
    audio.onended = () => {
      setIsFilePlaying(false);
    };

    await audio.play();
    setIsFilePlaying(true);

    return destNode.stream;
  }

  async function handleStartSession() {
    setIsStarting(true);
    setError("");

    try {
      let mediaStream;

      if (audioSourceMode === "audio-file") {
        if (!selectedFile) {
          throw new Error("Please select an audio file first.");
        }
        mediaStream = await setupAudioFileStream(selectedFile);
      } else if (audioSourceMode === "device-audio" && isNativeAndroidApp()) {
        const nativeBridge = await startNativeSystemAudioBridge();
        nativeBridgeRef.current = nativeBridge;
        mediaStream = nativeBridge.stream;
      } else {
        mediaStream = await captureHostAudio(audioSourceMode);
      }

      streamRef.current = mediaStream;
      setupVisualizer(mediaStream);

      // Create session on backend
      const newSession = await createSession({
        hostId: hostIdRef.current,
        hostName: sanitizeDisplayName(hostName, "Host"),
        audioSourceMode
      });

      setSession(newSession);

      // Keep browser alive while host switches to other apps or locks screen
      try {
        const bgAudio = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAP8A/w==");
        bgAudio.loop = true;
        bgAudio.volume = 0.001;
        bgAudio.play().catch(() => {});
        bgAudioRef.current = bgAudio;

        if ("mediaSession" in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: "TOGETHER Studio • Broadcasting",
            artist: sanitizeDisplayName(hostName, "Host"),
            album: `Room ${newSession.roomId}`
          });
          navigator.mediaSession.playbackState = "playing";
        }

        if ("wakeLock" in navigator) {
          navigator.wakeLock.request("screen").catch(() => {});
        }
      } catch (_bgErr) {}

      if (isNativeAndroidApp()) {
        enableNativeBackgroundPlayback({
          title: "TOGETHER Studio (Broadcasting)",
          text: `Streaming Room ${newSession.roomId} (Active in background)`,
          playing: true
        }).catch(() => {});
      }

      // Connect to Socket.IO signaling
      const socket = createSocket();
      socketRef.current = socket;

      socket.on("connect", () => {
        socket.emit("host-created-room", {
          roomId: newSession.roomId,
          hostId: hostIdRef.current
        });
      });

      socket.on("user-count-updated", (data) => {
        if (data.roomId === newSession.roomId) {
          setConnectedUsers(data.users || []);
        }
      });

      // When a listener joins, initiate WebRTC connection
      socket.on("listener-joined-room", async (data) => {
        const listenerId = data.listenerId;
        if (!listenerId || !streamRef.current) return;

        try {
          const pc = createPeerConnection({
            onIceCandidate: (candidate) => {
              socket.emit("signal:ice-candidate", {
                roomId: newSession.roomId,
                targetId: listenerId,
                candidate,
                senderId: hostIdRef.current
              });
            }
          });

          // Add audio tracks to peer connection
          streamRef.current.getAudioTracks().forEach((track) => {
            pc.addTrack(track, streamRef.current);
          });

          peerConnectionsRef.current.set(listenerId, pc);

          const offer = await pc.createOffer({
            offerToReceiveAudio: false,
            offerToReceiveVideo: false
          });
          await pc.setLocalDescription(offer);

          socket.emit("signal:offer", {
            roomId: newSession.roomId,
            targetListenerId: listenerId,
            offer,
            senderId: hostIdRef.current
          });
        } catch (_err) {
          // Failed to initiate offer for listener
        }
      });

      // Handle answer from listener
      socket.on("signal:answer", async (data) => {
        const pc = peerConnectionsRef.current.get(data.senderId);
        if (pc && data.answer) {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          } catch (_err) {}
        }
      });

      // Handle ICE candidates from listener
      socket.on("signal:ice-candidate", async (data) => {
        const pc = peerConnectionsRef.current.get(data.senderId);
        if (pc && data.candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (_err) {}
        }
      });

      // Handle listener disconnect
      socket.on("listener-disconnected", (data) => {
        const pc = peerConnectionsRef.current.get(data.listenerId);
        if (pc) {
          pc.close();
          peerConnectionsRef.current.delete(data.listenerId);
        }
      });

      // Handle chat messages
      socket.on("chat-message", (msg) => {
        setChatMessages((prev) => [...prev, msg]);
      });
    } catch (err) {
      setError(err.message || "Failed to start audio session.");
      teardownSession();
    } finally {
      setIsStarting(false);
    }
  }

  function teardownSession() {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (fileAudioRef.current) {
      fileAudioRef.current.pause();
      fileAudioRef.current = null;
    }
    if (fileObjectUrlRef.current) {
      URL.revokeObjectURL(fileObjectUrlRef.current);
      fileObjectUrlRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();

    if (nativeBridgeRef.current) {
      nativeBridgeRef.current.stop().catch(() => {});
      nativeBridgeRef.current = null;
    }

    if (bgAudioRef.current) {
      bgAudioRef.current.pause();
      bgAudioRef.current = null;
    }

    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.playbackState = "none";
      } catch (_e) {}
    }

    if (isNativeAndroidApp()) {
      disableNativeBackgroundPlayback().catch(() => {});
    }

    if (socketRef.current) {
      if (session?.roomId) {
        socketRef.current.emit("host-ended-session", { roomId: session.roomId });
      }
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    if (session?.roomId) {
      endSession(session.roomId).catch(() => {});
    }

    setSession(null);
    setConnectedUsers([]);
    setChatMessages([]);
  }

  function handleEndSession() {
    teardownSession();
  }

  function toggleMute() {
    if (!streamRef.current) return;
    const nextState = !isMuted;
    streamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !nextState;
    });
    setIsMuted(nextState);
  }

  function copyJoinLink() {
    if (!joinUrl) return;
    navigator.clipboard.writeText(joinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleSendChat(e) {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || !socketRef.current || !session?.roomId) return;

    socketRef.current.emit("chat-message", {
      roomId: session.roomId,
      senderId: hostIdRef.current,
      senderName: `${hostName} (Host)`,
      message: text
    });
    setChatInput("");
  }

  function toggleFilePlayback() {
    if (!fileAudioRef.current) return;
    if (fileAudioRef.current.paused) {
      fileAudioRef.current.play();
      setIsFilePlaying(true);
    } else {
      fileAudioRef.current.pause();
      setIsFilePlaying(false);
    }
  }

  function handleSeekFile(e) {
    if (!fileAudioRef.current || !fileDuration) return;
    const pct = parseFloat(e.target.value);
    const targetTime = (pct / 100) * fileDuration;
    fileAudioRef.current.currentTime = targetTime;
    setFileProgress(pct);
  }

  return (
    <AppShell>
      <div style={{ maxWidth: "1080px", margin: "24px auto 0" }}>
        {!session ? (
          /* PRE-SESSION STUDIO SETUP */
          <div className="content-card fade-in" style={{ padding: "36px", maxWidth: "560px", margin: "40px auto 0" }}>
            <div style={{ textAlign: "center", marginBottom: "28px" }}>
              <span style={{ fontSize: "2.5rem", display: "block", marginBottom: "8px" }}>🎙️</span>
              <h1 style={{ fontSize: "1.8rem", margin: "0 0 6px" }}>Host Studio</h1>
              <p className="subtle-text" style={{ margin: 0, fontSize: "0.95rem" }}>
                Choose your audio source and launch a live room.
              </p>
            </div>

            {error && (
              <div style={{
                background: "rgba(217, 56, 58, 0.1)",
                border: "1px solid rgba(217, 56, 58, 0.3)",
                padding: "12px 16px",
                borderRadius: "12px",
                color: "#d9383a",
                fontSize: "0.9rem",
                marginBottom: "20px"
              }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <label className="field-block">
                <span className="field-label">Host Name</span>
                <input
                  type="text"
                  placeholder="Host"
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  maxLength={30}
                  className="text-input"
                />
              </label>

              <div className="field-block">
                <span className="field-label">Audio Source</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginTop: "6px" }}>
                  <button
                    type="button"
                    className={`button-secondary ${audioSourceMode === "microphone" ? "active-pill" : ""}`}
                    onClick={() => setAudioSourceMode("microphone")}
                    style={{
                      padding: "10px 8px",
                      fontSize: "0.85rem",
                      fontWeight: audioSourceMode === "microphone" ? 700 : 500,
                      borderColor: audioSourceMode === "microphone" ? "#ff8c42" : "inherit"
                    }}
                  >
                    🎤 Microphone
                  </button>
                  <button
                    type="button"
                    className={`button-secondary ${audioSourceMode === "device-audio" ? "active-pill" : ""}`}
                    onClick={() => setAudioSourceMode("device-audio")}
                    style={{
                      padding: "10px 8px",
                      fontSize: "0.85rem",
                      fontWeight: audioSourceMode === "device-audio" ? 700 : 500,
                      borderColor: audioSourceMode === "device-audio" ? "#ff8c42" : "inherit"
                    }}
                  >
                    {isNativeAndroidApp() ? "📱 All Apps (YouTube, Spotify)" : "💻 All Apps / Tab"}
                  </button>
                  <button
                    type="button"
                    className={`button-secondary ${audioSourceMode === "audio-file" ? "active-pill" : ""}`}
                    onClick={() => setAudioSourceMode("audio-file")}
                    style={{
                      padding: "10px 8px",
                      fontSize: "0.85rem",
                      fontWeight: audioSourceMode === "audio-file" ? 700 : 500,
                      borderColor: audioSourceMode === "audio-file" ? "#ff8c42" : "inherit"
                    }}
                  >
                    📁 Audio File
                  </button>
                </div>
                {audioSourceMode === "device-audio" && !isNativeAndroidApp() && (
                  <p className="subtle-text" style={{ fontSize: "0.82rem", margin: "8px 0 0", lineHeight: 1.4 }}>
                    💡 <strong>To capture audio from phone apps (Spotify, YouTube, etc.):</strong> Use the TOGETHER Android App (utilizes Android’s internal playback capture). On laptop/PC, this shares tab & app audio directly.
                  </p>
                )}
              </div>

              {audioSourceMode === "audio-file" && (
                <div className="field-block">
                  <span className="field-label">Select Audio File</span>
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    className="text-input"
                    style={{ padding: "8px" }}
                  />
                  {selectedFile && (
                    <span className="subtle-text" style={{ fontSize: "0.82rem", marginTop: "4px", display: "block" }}>
                      Selected: <strong>{selectedFile.name}</strong>
                    </span>
                  )}
                </div>
              )}

              <button
                type="button"
                className="button-primary"
                onClick={handleStartSession}
                disabled={isStarting}
                style={{
                  width: "100%",
                  justifyContent: "center",
                  padding: "14px",
                  fontSize: "1.05rem",
                  marginTop: "8px"
                }}
              >
                {isStarting ? "Starting Studio..." : "Start Broadcasting Live &rarr;"}
              </button>
            </div>
          </div>
        ) : (
          /* ACTIVE LIVE STUDIO */
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "24px" }}>
            {/* Left Column: Streaming Controls & QR */}
            <div className="content-card fade-in" style={{ padding: "28px" }}>
              {/* Session Top Bar */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span className="live-pill" style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      background: "rgba(231, 76, 60, 0.15)",
                      color: "#c0392b",
                      padding: "4px 10px",
                      borderRadius: "999px",
                      fontSize: "0.82rem",
                      fontWeight: 700
                    }}>
                      <span style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: "#e74c3c"
                      }} />
                      LIVE BROADCASTING
                    </span>
                  </div>
                  <h1 style={{ fontSize: "1.45rem", margin: "2px 0 0" }}>
                    Room <span style={{ color: "var(--accent-primary)" }}>{session.roomId}</span>
                  </h1>
                </div>

                <button
                  type="button"
                  className="button-secondary"
                  onClick={handleEndSession}
                  style={{ color: "var(--accent-rose)", borderColor: "rgba(244, 63, 94, 0.3)", fontSize: "0.85rem", padding: "8px 14px" }}
                >
                  End Session
                </button>
              </div>

              {/* QR Code & Direct Link */}
              <div style={{
                background: "rgba(0, 0, 0, 0.25)",
                border: "1px solid var(--border-subtle)",
                padding: "20px",
                borderRadius: "18px",
                textAlign: "center",
                marginBottom: "24px"
              }}>
                <div style={{
                  background: "#fff",
                  padding: "12px",
                  borderRadius: "14px",
                  display: "inline-block",
                  boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
                  marginBottom: "12px"
                }}>
                  <QRCode value={joinUrl} size={160} />
                </div>
                <p className="subtle-text" style={{ fontSize: "0.85rem", margin: "0 0 12px" }}>
                  Scan with any phone camera to listen instantly
                </p>
                <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={copyJoinLink}
                    style={{ fontSize: "0.85rem", padding: "6px 14px" }}
                  >
                    {copied ? "✅ Link Copied!" : "📋 Copy Join Link"}
                  </button>
                </div>
              </div>

              {/* Audio Visualizer & Source info */}
              <div style={{
                background: "rgba(0, 0, 0, 0.25)",
                border: "1px solid var(--border-subtle)",
                padding: "18px",
                borderRadius: "16px",
                marginBottom: "20px"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <span className="field-label" style={{ margin: 0, textTransform: "capitalize" }}>
                    Source: {session.audioSourceMode.replace("-", " ")}
                  </span>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={toggleMute}
                    style={{ padding: "4px 10px", fontSize: "0.82rem" }}
                  >
                    {isMuted ? "🔇 Unmute Audio" : "🎤 Mute Audio"}
                  </button>
                </div>

                {/* Animated waveform bars */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  height: "44px"
                }}>
                  {[0.5, 0.9, 1.3, 1.6, 1.2, 0.8, 1.4, 0.6, 1.1, 1.5].map((mult, i) => {
                    const h = isMuted ? 6 : Math.max(6, Math.min(44, Math.round(audioLevel * mult * 0.45)));
                    return (
                      <div
                        key={i}
                        style={{
                          width: "6px",
                          height: `${h}px`,
                          borderRadius: "3px",
                          background: isMuted ? "rgba(255,255,255,0.15)" : audioLevel > 5 ? "var(--accent-primary)" : "rgba(255,255,255,0.15)",
                          boxShadow: !isMuted && audioLevel > 5 ? "0 0 10px var(--accent-primary-glow)" : "none",
                          transition: "height 0.08s ease"
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Audio File Player (if audio-file mode) */}
              {session.audioSourceMode === "audio-file" && (
                <div style={{
                  background: "rgba(0, 0, 0, 0.03)",
                  padding: "16px",
                  borderRadius: "16px",
                  marginBottom: "20px"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>File Stream Controls</span>
                    <button
                      type="button"
                      className="button-primary"
                      onClick={toggleFilePlayback}
                      style={{ padding: "4px 12px", fontSize: "0.82rem" }}
                    >
                      {isFilePlaying ? "⏸ Pause" : "▶ Play"}
                    </button>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={fileProgress}
                    onChange={handleSeekFile}
                    style={{ width: "100%", accentColor: "#ff8c42" }}
                  />
                </div>
              )}
            </div>

            {/* Right Column: Participants & Room Chat */}
            <div className="content-card fade-in" style={{ padding: "24px", display: "flex", flexDirection: "column", height: "620px" }}>
              {/* Header with Connected Listeners */}
              <div style={{ marginBottom: "16px", borderBottom: "1px solid rgba(0,0,0,0.06)", paddingBottom: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ margin: 0, fontSize: "1.1rem" }}>👥 Listeners ({connectedUsers.length})</h3>
                  <span className="live-pill" style={{
                    fontSize: "0.78rem",
                    padding: "3px 8px",
                    background: "rgba(46, 204, 113, 0.15)",
                    color: "#27ae60",
                    borderRadius: "999px",
                    fontWeight: 600
                  }}>
                    {connectedUsers.length} Online
                  </span>
                </div>
                {connectedUsers.length > 0 && (
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
                    {connectedUsers.map((u) => (
                      <span key={u.id} style={{
                        fontSize: "0.78rem",
                        padding: "2px 8px",
                        background: "rgba(0,0,0,0.05)",
                        borderRadius: "6px"
                      }}>
                        {u.username}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Chat Title */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <h4 style={{ margin: 0, fontSize: "0.95rem" }}>💬 Room Chat</h4>
              </div>

              {/* Chat Messages */}
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
                  <p className="subtle-text" style={{ textAlign: "center", margin: "auto", fontSize: "0.85rem" }}>
                    No messages yet. Messages from listeners will appear here.
                  </p>
                ) : (
                  chatMessages.map((msg) => {
                    const isMe = msg.senderId === hostIdRef.current;
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
                  placeholder="Send a message to room..."
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
        )}
      </div>
    </AppShell>
  );
}
