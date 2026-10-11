import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import QRCode from "react-qr-code";
import AppShell from "../components/AppShell";
import { useAudioRoom } from "../context/AudioRoomContext";
import { createSession, endSession, updateSessionTrack } from "../lib/api";
import { createAppId } from "../lib/ids";
import { sanitizeDisplayName } from "../lib/sanitize";
import { createSocket } from "../lib/socket";
import { createPeerConnection, getDynamicIceServers } from "../lib/webrtc";
import { createSpeechRecognizer, isSpeechRecognitionSupported } from "../lib/speechRecognition";
import {
  disableNativeBackgroundPlayback,
  enableNativeBackgroundPlayback,
  isNativeAndroidApp
} from "../lib/nativeAudio";

export default function HostDashboardPage() {
  const [searchParams] = useSearchParams();
  const initialName = searchParams.get("name") || "";
  const initialTitle = searchParams.get("title") || "";
  const initialCategory = searchParams.get("category") || "Music";

  const { registerActiveSession, leaveActiveSession, setAudioLevel: setGlobalAudioLevel } = useAudioRoom();

  const [hostName, setHostName] = useState(initialName || "Host");
  const [sessionTitle, setSessionTitle] = useState(initialTitle || "");
  const [sessionCategory, setSessionCategory] = useState(initialCategory || "Music");
  const [session, setSession] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [liveReactions, setLiveReactions] = useState([]);
  const [announcedTrack, setAnnouncedTrack] = useState("");

  // Audio Mixer Channels
  const [isMicOn, setIsMicOn] = useState(false); // DEFAULT FALSE (MUTED - MUSIC ONLY)
  const [micVolume, setMicVolume] = useState(1.0);
  const [isAppAudioActive, setIsAppAudioActive] = useState(false);
  const [appAudioVolume, setAppAudioVolume] = useState(1.0);
  
  // Audio File Deck
  const [selectedFileName, setSelectedFileName] = useState("");
  const [isFilePlaying, setIsFilePlaying] = useState(false);
  const [fileProgress, setFileProgress] = useState(0);
  const [fileDuration, setFileDuration] = useState(0);
  const [fileCurrentTime, setFileCurrentTime] = useState(0);
  const [fileVolume, setFileVolume] = useState(1.0);

  // Visualizer & Stats
  const [masterLevel, setMasterLevel] = useState(0);
  const [leftVu, setLeftVu] = useState(0);
  const [rightVu, setRightVu] = useState(0);
  const [connectedUsers, setConnectedUsers] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");

  // Origin for QR Code
  const [networkOrigin, setNetworkOrigin] = useState(window.location.origin);

  const hostIdRef = useRef(createAppId("host"));
  const socketRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const chatScrollRef = useRef(null);
  const bgAudioRef = useRef(null);
  const wakeLockRef = useRef(null);
  const hostKeyRef = useRef(null);
  const roomContainerRef = useRef(null);
  const accumulatedHueRef = useRef(150);

  // Core WebAudio Mixer Graph
  const audioContextRef = useRef(null);
  const mixerDestinationRef = useRef(null);
  const masterStreamRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);

  // Channel Nodes
  const micStreamRef = useRef(null);
  const micSourceNodeRef = useRef(null);
  const micGainNodeRef = useRef(null);

  const appAudioStreamRef = useRef(null);
  const appAudioSourceNodeRef = useRef(null);
  const appAudioGainNodeRef = useRef(null);

  const fileAudioRef = useRef(null);
  const fileSourceNodeRef = useRef(null);
  const fileGainNodeRef = useRef(null);
  const fileObjectUrlRef = useRef(null);

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

  // Initialize Master WebAudio Mixer Graph
  function initMasterMixer() {
    if (audioContextRef.current) return audioContextRef.current;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx({ sampleRate: 48000 });
    audioContextRef.current = ctx;

    const destination = ctx.createMediaStreamDestination();
    mixerDestinationRef.current = destination;
    masterStreamRef.current = destination.stream;

    // Master Analyser for Stereo VU & Spectrum
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.6;
    analyserRef.current = analyser;

    // Standard Opus discontinuous transmission (DTX) handles silence without artificial carrier oscillators

    // Microphone Gain Channel (DEFAULT 0.0 - MUTED)
    const micGain = ctx.createGain();
    micGain.gain.setValueAtTime(0.0, ctx.currentTime);
    micGain.connect(destination);
    micGain.connect(analyser);
    micGainNodeRef.current = micGain;

    // App/System Audio Gain Channel
    const appGain = ctx.createGain();
    appGain.gain.setValueAtTime(appAudioVolume, ctx.currentTime);
    appGain.connect(destination);
    appGain.connect(analyser);
    appAudioGainNodeRef.current = appGain;

    // Music File Gain Channel
    const fileGain = ctx.createGain();
    fileGain.gain.setValueAtTime(fileVolume, ctx.currentTime);
    fileGain.connect(destination);
    fileGain.connect(analyser);
    fileGain.connect(ctx.destination); // Route file to host local speaker/headphones too
    fileGainNodeRef.current = fileGain;

    // Visualizer loop
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const renderMeters = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteFrequencyData(dataArray);

      let sum = 0;
      let leftSum = 0;
      let rightSum = 0;
      let bassSum = 0;
      const half = Math.floor(dataArray.length / 2);

      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
        if (i < 4) bassSum += dataArray[i];
        if (i < half) leftSum += dataArray[i];
        else rightSum += dataArray[i];
      }

      const avg = sum / dataArray.length;
      const lAvg = leftSum / (half || 1);
      const rAvg = rightSum / (half || 1);
      const bass = Math.min(100, Math.round((bassSum / 4 / 128) * 100));

      setMasterLevel(Math.min(100, Math.round((avg / 128) * 100)));
      setLeftVu(Math.min(100, Math.round((lAvg / 128) * 100)));
      setRightVu(Math.min(100, Math.round((rAvg / 128) * 100)));

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

      animFrameRef.current = requestAnimationFrame(renderMeters);
    };
    renderMeters();

    return ctx;
  }

  // Toggle Microphone (Default is OFF / MUTED)
  async function toggleMicrophone() {
    const ctx = initMasterMixer();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    if (isMicOn) {
      // MUTE MIC IMMEDIATELY
      if (micGainNodeRef.current) {
        micGainNodeRef.current.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      }
      setIsMicOn(false);
      return;
    }

    // UNMUTE / INITIALIZE MIC
    try {
      if (!micStreamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: false
        });
        micStreamRef.current = stream;

        const sourceNode = ctx.createMediaStreamSource(stream);
        micSourceNodeRef.current = sourceNode;
        sourceNode.connect(micGainNodeRef.current);
      }

      if (micGainNodeRef.current) {
        micGainNodeRef.current.gain.setTargetAtTime(micVolume, ctx.currentTime, 0.03);
      }
      setIsMicOn(true);
    } catch (err) {
      setError("Microphone permission was denied or is unavailable.");
    }
  }

  function handleMicVolumeChange(e) {
    const val = parseFloat(e.target.value);
    setMicVolume(val);
    if (isMicOn && micGainNodeRef.current && audioContextRef.current) {
      micGainNodeRef.current.gain.setTargetAtTime(val, audioContextRef.current.currentTime, 0.03);
    }
  }

  // Toggle App Audio (Spotify, YouTube, Tabs, Screens)
  async function startAppAudioSharing() {
    const ctx = initMasterMixer();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("System/App audio capture is not supported in this browser.");
      }

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length === 0) {
        displayStream.getTracks().forEach((t) => t.stop());
        throw new Error("No audio was selected. Remember to check 'Share audio' or 'Also share tab audio'.");
      }

      // Keep video tracks alive (disabled) so the browser capture pipeline doesn't terminate on app switch
      displayStream.getVideoTracks().forEach((t) => {
        t.enabled = false;
        t.onended = () => {
          stopAppAudioSharing();
        };
      });

      // If already had a stream, disconnect it
      if (appAudioSourceNodeRef.current) {
        appAudioSourceNodeRef.current.disconnect();
      }

      appAudioStreamRef.current = displayStream;
      const source = ctx.createMediaStreamSource(new MediaStream(audioTracks));
      appAudioSourceNodeRef.current = source;
      source.connect(appAudioGainNodeRef.current);

      setIsAppAudioActive(true);

      audioTracks[0].onended = () => {
        stopAppAudioSharing();
      };
    } catch (err) {
      if (err.name !== "NotAllowedError") {
        setError(err.message || "Could not capture device/app audio.");
      }
    }
  }

  function stopAppAudioSharing() {
    if (appAudioStreamRef.current) {
      appAudioStreamRef.current.getTracks().forEach((t) => t.stop());
      appAudioStreamRef.current = null;
    }
    if (appAudioSourceNodeRef.current) {
      appAudioSourceNodeRef.current.disconnect();
      appAudioSourceNodeRef.current = null;
    }
    setIsAppAudioActive(false);
  }

  function handleAppAudioVolumeChange(e) {
    const val = parseFloat(e.target.value);
    setAppAudioVolume(val);
    if (appAudioGainNodeRef.current && audioContextRef.current) {
      appAudioGainNodeRef.current.gain.setTargetAtTime(val, audioContextRef.current.currentTime, 0.03);
    }
  }

  // Handle Audio File Loading & Playback (DJ File Deck)
  async function handleAudioFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const ctx = initMasterMixer();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    if (fileAudioRef.current) {
      fileAudioRef.current.pause();
    }
    if (fileObjectUrlRef.current) {
      URL.revokeObjectURL(fileObjectUrlRef.current);
    }

    const objectUrl = URL.createObjectURL(file);
    fileObjectUrlRef.current = objectUrl;
    setSelectedFileName(file.name);

    const audio = new Audio();
    audio.src = objectUrl;
    audio.preload = "auto";
    audio.playsInline = true;
    fileAudioRef.current = audio;

    audio.onloadedmetadata = () => {
      setFileDuration(audio.duration || 0);
    };

    audio.ontimeupdate = () => {
      if (audio.duration) {
        setFileCurrentTime(audio.currentTime);
        setFileProgress((audio.currentTime / audio.duration) * 100);
      }
    };

    audio.onended = () => {
      setIsFilePlaying(false);
    };

    // Connect file to WebAudio graph
    if (!fileSourceNodeRef.current) {
      const source = ctx.createMediaElementSource(audio);
      fileSourceNodeRef.current = source;
      source.connect(fileGainNodeRef.current);
    }

    await audio.play();
    setIsFilePlaying(true);
    handleBroadcastTrack(file.name.replace(/\.[^/.]+$/, ""), hostName);
  }

  function toggleFilePlay() {
    if (!fileAudioRef.current) return;
    if (isFilePlaying) {
      fileAudioRef.current.pause();
      setIsFilePlaying(false);
    } else {
      fileAudioRef.current.play();
      setIsFilePlaying(true);
    }
  }

  function handleFileSeek(e) {
    if (!fileAudioRef.current || !fileDuration) return;
    const seekPercent = parseFloat(e.target.value);
    const targetTime = (seekPercent / 100) * fileDuration;
    fileAudioRef.current.currentTime = targetTime;
    setFileProgress(seekPercent);
  }

  function handleFileVolumeChange(e) {
    const val = parseFloat(e.target.value);
    setFileVolume(val);
    if (fileGainNodeRef.current && audioContextRef.current) {
      fileGainNodeRef.current.gain.setTargetAtTime(val, audioContextRef.current.currentTime, 0.03);
    }
  }

  // Launch Universal Broadcast Session
  async function handleStartSession() {
    setIsStarting(true);
    setError("");

    try {
      const ctx = initMasterMixer();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      // Create session on backend
      const newSession = await createSession({
        hostId: hostIdRef.current,
        hostName: sanitizeDisplayName(hostName, "Host"),
        title: sessionTitle.trim() || `${sanitizeDisplayName(hostName, "Host")}'s Room`,
        category: sessionCategory || "Music",
        isPublic: true,
        audioSourceMode: "universal"
      });

      hostKeyRef.current = newSession.hostKey;
      setSession(newSession);

      // Register session with global context for persistent audio
      registerActiveSession({
        roomId: newSession.roomId,
        userRole: "host",
        title: newSession.title,
        host: newSession.hostName,
        cat: newSession.category,
        socket: null, // will be attached right below
        cleanup: teardownSession
      });

      // Keep mobile browsers alive in background (screen off / app switch)
      try {
        let bgAudio = bgAudioRef.current;
        if (!bgAudio) {
          bgAudio = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAP8A/w==");
          bgAudioRef.current = bgAudio;
        } else {
          bgAudio.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAP8A/w==";
        }
        bgAudio.loop = true;
        bgAudio.volume = 0.001;
        bgAudio.setAttribute("playsinline", "true");
        bgAudio.setAttribute("webkit-playsinline", "true");
        bgAudio.play().catch(() => {});

        if ("mediaSession" in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: `TOGETHER Studio • Live Broadcast`,
            artist: sanitizeDisplayName(hostName, "Host"),
            album: `Room: ${newSession.roomId}`
          });
          navigator.mediaSession.playbackState = "playing";
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
          hostId: hostIdRef.current,
          hostKey: newSession.hostKey
        });
      });

      socket.on("user-count-updated", (data) => {
        if (data.roomId === newSession.roomId) {
          setConnectedUsers(data.users || []);
        }
      });

      // When a listener joins, send our master mixer stream over WebRTC
      socket.on("listener-joined-room", async (data) => {
        const listenerId = data.listenerId;
        if (!listenerId || !masterStreamRef.current) return;

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

          // Add master mixed audio track to peer connection
          masterStreamRef.current.getAudioTracks().forEach((track) => {
            pc.addTrack(track, masterStreamRef.current);
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
        } catch (_err) {}
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

      // Handle audience reactions
      socket.on("reaction", (data) => {
        setLiveReactions((prev) => [...prev.slice(-12), data]);
      });
    } catch (err) {
      setError(err.message || "Failed to start live studio broadcast.");
    } finally {
      setIsStarting(false);
    }
  }

  // Teardown everything on session end
  function teardownSession() {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (fileAudioRef.current) {
      fileAudioRef.current.pause();
      fileAudioRef.current = null;
    }
    if (fileObjectUrlRef.current) {
      URL.revokeObjectURL(fileObjectUrlRef.current);
      fileObjectUrlRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (appAudioStreamRef.current) {
      appAudioStreamRef.current.getTracks().forEach((t) => t.stop());
      appAudioStreamRef.current = null;
    }

    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    if (bgAudioRef.current) {
      bgAudioRef.current.pause();
      bgAudioRef.current = null;
    }

    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
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
        socketRef.current.emit("host-ended-session", {
          roomId: session.roomId,
          hostKey: hostKeyRef.current
        });
      }
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    if (session?.roomId) {
      endSession(session.roomId, hostKeyRef.current).catch(() => {});
    }

    setSession(null);
    leaveActiveSession();
    setConnectedUsers([]);
    setChatMessages([]);
    setIsMicOn(false);
    setIsAppAudioActive(false);
    setIsFilePlaying(false);
    setSelectedFileName("");
  }

  useEffect(() => {
    return () => {
      teardownSession();
    };
  }, []);

  useEffect(() => {
    getDynamicIceServers().catch(() => {});
  }, []);

  const autostart = searchParams.get("autostart") === "1";
  const hasAutoStartedRef = useRef(false);

  useEffect(() => {
    if (autostart && !session && !isStarting && !hasAutoStartedRef.current) {
      hasAutoStartedRef.current = true;
      handleStartSession();
    }
  }, [autostart, session, isStarting]);

  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (audioContextRef.current && audioContextRef.current.state === "suspended") {
        audioContextRef.current.resume().catch(() => {});
      }
      if (bgAudioRef.current && bgAudioRef.current.paused) {
        bgAudioRef.current.play().catch(() => {});
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("focus", handleVisibilityOrFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("focus", handleVisibilityOrFocus);
    };
  }, [session]);

  const speechRecognizerRef = useRef(null);

  // Live Speech Recognition for Classroom / Lecture / Accessibility Mode
  useEffect(() => {
    if (isTranscribing && isMicOn) {
      if (isSpeechRecognitionSupported()) {
        const recognizer = createSpeechRecognizer({
          onTranscript: ({ text, isFinal }) => {
            if (socketRef.current && session?.roomId) {
              socketRef.current.emit("transcript-chunk", {
                roomId: session.roomId,
                text,
                isFinal,
                senderName: `${hostName} (Host)`
              });
            }
          },
          onError: () => {}
        });

        if (recognizer) {
          try {
            recognizer.start();
            speechRecognizerRef.current = recognizer;
          } catch (_e) {}
        }
      }
    } else {
      if (speechRecognizerRef.current) {
        try {
          speechRecognizerRef.current.stop();
        } catch (_e) {}
        speechRecognizerRef.current = null;
      }
    }

    return () => {
      if (speechRecognizerRef.current) {
        try {
          speechRecognizerRef.current.stop();
        } catch (_e) {}
        speechRecognizerRef.current = null;
      }
    };
  }, [isTranscribing, isMicOn, session, hostName]);

  function handleBroadcastTrack(title, artist) {
    if (!session?.roomId || !socketRef.current) return;
    const cleanTitle = (title || "").trim();
    const cleanArtist = (artist || hostName || "").trim();
    if (!cleanTitle) return;

    const track = {
      title: cleanTitle,
      artist: cleanArtist,
      updatedAt: Date.now(),
      isPlaying: true
    };

    socketRef.current.emit("playback-sync", {
      roomId: session.roomId,
      currentTrack: track
    });

    updateSessionTrack(session.roomId, { currentTrack: track }, hostKeyRef.current).catch(() => {});
    setAnnouncedTrack(`${cleanTitle} — ${cleanArtist}`);
  }

  function handleSendChat(e) {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || !socketRef.current || !session) return;

    socketRef.current.emit("chat-message", {
      roomId: session.roomId,
      senderId: hostIdRef.current,
      senderName: `${hostName} (Host)`,
      message: text
    });
    setChatInput("");
  }

  function handleCopyInvite() {
    if (!joinUrl) return;
    navigator.clipboard.writeText(joinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  function formatTime(secs) {
    if (!secs || isNaN(secs)) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }

  // Pre-session Screen: One-Click Go Live
  if (!session) {
    if (isStarting) {
      return (
        <AppShell>
          <div style={{ maxWidth: "560px", margin: "60px auto 0", textAlign: "center" }}>
            <div className="content-card fade-in" style={{ padding: "48px 32px", display: "flex", flexDirection: "column", alignItems: "center", gap: "20px" }}>
              <div className="dj-turntable-wrapper">
                <div className="dj-light-ring-outer" />
                <div className="dj-light-ring-inner" />
                <div className="dj-vinyl-disc" style={{ animationDuration: "1.2s" }}>
                  <div className="dj-disc-center-label" />
                </div>
              </div>
              <div>
                <h2 style={{ fontSize: "1.6rem", margin: "0 0 8px", fontWeight: 800 }}>Initializing Live Studio...</h2>
                <p className="subtle-text" style={{ fontSize: "0.95rem", margin: 0 }}>
                  Connecting to broadcast stage & preparing your live room link...
                </p>
              </div>
            </div>
          </div>
        </AppShell>
      );
    }

    return (
      <AppShell>
        <div style={{ maxWidth: "620px", margin: "40px auto 0" }}>
          <div className="content-card fade-in" style={{ padding: "36px" }}>
            <div style={{ textAlign: "center", marginBottom: "28px" }}>
              <div
                style={{
                  width: "64px",
                  height: "64px",
                  borderRadius: "20px",
                  background: "linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-cyan) 100%)",
                  boxShadow: "0 10px 30px rgba(16, 185, 129, 0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "2rem",
                  margin: "0 auto 16px"
                }}
              >
                🎛️
              </div>
              <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: "0 0 8px" }}>
                Universal Broadcast Studio
              </h1>
              <p className="subtle-text" style={{ fontSize: "0.95rem", margin: 0 }}>
                One live link. Share music from Spotify, YouTube, your audio files, and optionally use your mic.
              </p>
            </div>

            {error && (
              <div
                style={{
                  background: "rgba(244, 63, 94, 0.15)",
                  border: "1px solid var(--accent-rose)",
                  padding: "14px",
                  borderRadius: "var(--radius-control)",
                  color: "#ff8c94",
                  fontSize: "0.88rem",
                  marginBottom: "20px"
                }}
              >
                {error}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleStartSession();
              }}
              style={{ display: "flex", flexDirection: "column", gap: "20px" }}
            >
              <label className="field-block">
                <span className="field-label">Host / DJ Display Name</span>
                <input
                  type="text"
                  placeholder="e.g. DJ Pulse"
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  maxLength={30}
                  className="text-input"
                  style={{ fontSize: "1rem", padding: "14px" }}
                />
              </label>

              <label className="field-block">
                <span className="field-label">Broadcast Title</span>
                <input
                  type="text"
                  placeholder="e.g. Late Night Lo-Fi Session"
                  value={sessionTitle}
                  onChange={(e) => setSessionTitle(e.target.value)}
                  maxLength={50}
                  className="text-input"
                  style={{ fontSize: "1rem", padding: "14px" }}
                />
              </label>

              <label className="field-block">
                <span className="field-label">Category</span>
                <select
                  value={sessionCategory}
                  onChange={(e) => setSessionCategory(e.target.value)}
                  className="text-input"
                  style={{ fontSize: "1rem", padding: "14px" }}
                >
                  <option value="Music">🎵 Music & DJ</option>
                  <option value="Study">📚 Study & Focus</option>
                  <option value="Lecture">🎓 Classroom Lecture</option>
                  <option value="Podcast">🎙️ Podcast & Talk</option>
                  <option value="DJ">🎛️ DJ Stage</option>
                </select>
              </label>

              {/* Master studio spec overview */}
              <div
                style={{
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-control)",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  fontSize: "0.85rem",
                  color: "var(--text-secondary)"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "1.2rem" }}>🎵</span>
                  <div>
                    <strong style={{ color: "var(--text-main)" }}>Open Multi-Source Mixer:</strong> Switch between Spotify, YouTube, & music files anytime inside the live link.
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "1.2rem" }}>🔇</span>
                  <div>
                    <strong style={{ color: "var(--accent-primary)" }}>Microphone Muted by Default:</strong> Zero voice or room noise leaks into the music unless you tap to speak.
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "1.2rem" }}>🔋</span>
                  <div>
                    <strong style={{ color: "var(--text-main)" }}>Background Playback:</strong> Audio keeps streaming while you switch apps or turn off your screen.
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="button-primary"
                disabled={isStarting}
                style={{
                  padding: "16px",
                  fontSize: "1.05rem",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "10px"
                }}
              >
                {isStarting ? "Initializing Studio..." : "⚡ Launch Live Stage"}
              </button>
            </form>
          </div>
        </div>
      </AppShell>
    );
  }

  // Active Broadcast Studio Console
  return (
    <AppShell>
      <audio ref={bgAudioRef} loop playsInline style={{ display: "none" }} />
      <div ref={roomContainerRef} style={{ maxWidth: "1120px", margin: "16px auto 0", position: "relative" }}>
        {/* DJ Reactive Ambient Stage Light Orbs */}
        <div className="dj-ambient-stage">
          <div className="dj-orb-1" />
          <div className="dj-orb-2" />
        </div>

        {/* Top Studio Bar */}
        <div
          className="dj-reactive-card"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "14px",
            marginBottom: "20px",
            padding: "16px 20px",
            background: "var(--bg-surface)",
            borderRadius: "var(--radius-card)"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span
              style={{
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                background: "var(--accent-primary)",
                boxShadow: "0 0 12px var(--accent-primary-glow)",
                display: "inline-block",
                animation: "pulseLive 1.5s infinite ease-in-out"
              }}
            />
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontWeight: 800, fontSize: "1.1rem" }}>{hostName} • LIVE STAGE</span>
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: "999px",
                    background: "rgba(16, 185, 129, 0.15)",
                    color: "var(--accent-primary)",
                    border: "1px solid rgba(16, 185, 129, 0.3)"
                  }}
                >
                  {session.roomId}
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
                  {session.category || sessionCategory || "Music"}
                </span>
              </div>
              <span className="subtle-text" style={{ fontSize: "0.8rem" }}>
                {session.title || sessionTitle || "Universal Audio Stream"} • Lossless 48kHz Stereo
              </span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <button
              type="button"
              className={`button-secondary ${isTranscribing ? "active-pill" : ""}`}
              onClick={() => setIsTranscribing(!isTranscribing)}
              title="Live speech-to-text subtitles for classroom / lecture / accessibility"
              style={{ fontSize: "0.85rem", padding: "8px 14px" }}
            >
              {isTranscribing ? "🎙️ Captions ON [CC]" : "🎙️ Enable Captions [CC]"}
            </button>

            <button
              type="button"
              className="button-secondary"
              onClick={handleCopyInvite}
              style={{ fontSize: "0.85rem", padding: "8px 14px" }}
            >
              {copied ? "✓ Link Copied!" : "📋 Copy Link"}
            </button>

            <button
              type="button"
              className="button-danger"
              onClick={teardownSession}
              style={{ fontSize: "0.85rem", padding: "8px 14px" }}
            >
              End Broadcast
            </button>
          </div>
        </div>

        {/* Live Track Announcement & Broadcast Bar */}
        <div
          style={{
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-control)",
            padding: "10px 16px",
            marginBottom: "20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "10px"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: "260px" }}>
            <span style={{ fontSize: "1.1rem" }}>🎵</span>
            <input
              type="text"
              placeholder="Broadcast Track Name (Spotify, YouTube, Vinyl)..."
              value={announcedTrack}
              onChange={(e) => setAnnouncedTrack(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleBroadcastTrack(announcedTrack, hostName);
                }
              }}
              className="text-input"
              style={{ padding: "6px 12px", fontSize: "0.86rem", flex: 1 }}
            />
            <button
              type="button"
              className="button-primary"
              onClick={() => handleBroadcastTrack(announcedTrack, hostName)}
              style={{ padding: "6px 14px", fontSize: "0.82rem", whiteSpace: "nowrap" }}
            >
              Sync Track
            </button>
          </div>

          {/* Floating live reaction previews */}
          {liveReactions.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span className="subtle-text" style={{ fontSize: "0.78rem" }}>Reactions:</span>
              {liveReactions.slice(-4).map((r) => (
                <span
                  key={r.id}
                  className="fade-in"
                  title={`${r.senderName} sent ${r.emoji}`}
                  style={{
                    fontSize: "1.1rem",
                    background: "rgba(255,255,255,0.08)",
                    padding: "2px 6px",
                    borderRadius: "6px"
                  }}
                >
                  {r.emoji}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Studio Grid: Mixer Console (Left) + Backstage & Chat (Right) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "24px" }}>
          {/* Main DJ Audio Mixer Desk */}
          <div className="content-card dj-reactive-card" style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "22px" }}>
            {/* DJ Spinning Vinyl Turntable with Audio-Reactive Light Rings */}
            <div style={{ display: "flex", justifyContent: "center", padding: "6px 0 12px" }}>
              <div className="dj-turntable-wrapper">
                <div className="dj-light-ring-outer" />
                <div className="dj-light-ring-inner" />
                <div className="dj-vinyl-disc">
                  <div className="dj-disc-center-label" />
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "1.3rem" }}>🎛️</span>
                <h2 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>Audio Mixer Console</h2>
              </div>
              <span
                style={{
                  fontSize: "0.72rem",
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  color: isMicOn ? "#ff4757" : "var(--accent-primary)",
                  border: `1px solid ${isMicOn ? "rgba(255, 71, 87, 0.5)" : "rgba(16, 185, 129, 0.4)"}`,
                  padding: "4px 10px",
                  borderRadius: "999px",
                  background: isMicOn ? "rgba(255, 71, 87, 0.15)" : "rgba(16, 185, 129, 0.1)"
                }}
              >
                {isMicOn ? "🔴 VOICE ON AIR" : "🎵 MUSIC ONLY (MIC MUTED)"}
              </span>
            </div>

            {/* CHANNEL 1: Host Voice Mic (OFF BY DEFAULT) */}
            <div
              style={{
                background: isMicOn ? "rgba(255, 71, 87, 0.08)" : "rgba(255, 255, 255, 0.03)",
                border: `1px solid ${isMicOn ? "rgba(255, 71, 87, 0.4)" : "var(--border-subtle)"}`,
                borderRadius: "var(--radius-control)",
                padding: "16px",
                transition: "all 0.25s ease"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "1.1rem" }}>🎙️</span>
                    <strong style={{ fontSize: "0.95rem" }}>DJ Voice Mic</strong>
                  </div>
                  <span className="subtle-text" style={{ fontSize: "0.78rem" }}>
                    {isMicOn ? "Microphone is live over the stream" : "Muted by default • Tap to speak on air"}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={toggleMicrophone}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "999px",
                    fontWeight: 700,
                    fontSize: "0.85rem",
                    cursor: "pointer",
                    border: "none",
                    background: isMicOn ? "#ff4757" : "rgba(255, 255, 255, 0.1)",
                    color: isMicOn ? "#fff" : "var(--text-secondary)",
                    boxShadow: isMicOn ? "0 0 16px rgba(255, 71, 87, 0.5)" : "none",
                    transition: "all 0.2s ease"
                  }}
                >
                  {isMicOn ? "🔴 Mic Live (Tap to Mute)" : "🔇 Mic Muted (Tap to Speak)"}
                </button>
              </div>

              {isMicOn && (
                <div className="fade-in" style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "10px" }}>
                  <span className="subtle-text" style={{ fontSize: "0.78rem", minWidth: "70px" }}>
                    Voice Level: {Math.round(micVolume * 100)}%
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.05"
                    value={micVolume}
                    onChange={handleMicVolumeChange}
                    style={{ flex: 1 }}
                  />
                </div>
              )}
            </div>

            {/* CHANNEL 2: Spotify & App Audio Stream */}
            <div
              style={{
                background: isAppAudioActive ? "rgba(16, 185, 129, 0.08)" : "rgba(255, 255, 255, 0.03)",
                border: `1px solid ${isAppAudioActive ? "rgba(16, 185, 129, 0.4)" : "var(--border-subtle)"}`,
                borderRadius: "var(--radius-control)",
                padding: "16px",
                transition: "all 0.25s ease"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "1.1rem" }}>💻</span>
                    <strong style={{ fontSize: "0.95rem" }}>App & Device Audio</strong>
                  </div>
                  <span className="subtle-text" style={{ fontSize: "0.78rem" }}>
                    {isAppAudioActive ? "Streaming Spotify, YouTube, or tab audio" : "Stream any music app or browser audio"}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={isAppAudioActive ? stopAppAudioSharing : startAppAudioSharing}
                  className={isAppAudioActive ? "button-secondary" : "button-primary"}
                  style={{ fontSize: "0.85rem", padding: "8px 16px" }}
                >
                  {isAppAudioActive ? "⏹️ Stop App Audio" : "🎵 Share App Audio"}
                </button>
              </div>

              {isAppAudioActive && (
                <div className="fade-in" style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "10px" }}>
                  <span className="subtle-text" style={{ fontSize: "0.78rem", minWidth: "70px" }}>
                    Volume: {Math.round(appAudioVolume * 100)}%
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.05"
                    value={appAudioVolume}
                    onChange={handleAppAudioVolumeChange}
                    style={{ flex: 1 }}
                  />
                </div>
              )}
            </div>

            {/* CHANNEL 3: Audio File Deck (MP3 / WAV / FLAC) */}
            <div
              style={{
                background: selectedFileName ? "rgba(6, 182, 212, 0.08)" : "rgba(255, 255, 255, 0.03)",
                border: `1px solid ${selectedFileName ? "rgba(6, 182, 212, 0.4)" : "var(--border-subtle)"}`,
                borderRadius: "var(--radius-control)",
                padding: "16px",
                transition: "all 0.25s ease"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "1.1rem" }}>📁</span>
                    <strong style={{ fontSize: "0.95rem" }}>Music File Player</strong>
                  </div>
                  <span className="subtle-text" style={{ fontSize: "0.78rem" }}>
                    {selectedFileName || "Load & play local MP3, WAV, or FLAC songs"}
                  </span>
                </div>

                <label
                  className="button-secondary"
                  style={{
                    fontSize: "0.85rem",
                    padding: "8px 16px",
                    cursor: "pointer",
                    display: "inline-block"
                  }}
                >
                  {selectedFileName ? "Change File" : "Choose File"}
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={handleAudioFileSelect}
                    style={{ display: "none" }}
                  />
                </label>
              </div>

              {/* Embedded Player when file is loaded */}
              {selectedFileName && (
                <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <button
                      type="button"
                      onClick={toggleFilePlay}
                      className="button-primary"
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "50%",
                        padding: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                      }}
                    >
                      {isFilePlaying ? "⏸" : "▶"}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="0.1"
                      value={fileProgress}
                      onChange={handleFileSeek}
                      style={{ flex: 1 }}
                    />
                    <span className="subtle-text" style={{ fontSize: "0.75rem", minWidth: "75px", textAlign: "right" }}>
                      {formatTime(fileCurrentTime)} / {formatTime(fileDuration)}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span className="subtle-text" style={{ fontSize: "0.78rem", minWidth: "70px" }}>
                      Track Gain: {Math.round(fileVolume * 100)}%
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="1.5"
                      step="0.05"
                      value={fileVolume}
                      onChange={handleFileVolumeChange}
                      style={{ flex: 1 }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Stereo VU Meter & Output Monitor */}
            <div
              style={{
                background: "rgba(0, 0, 0, 0.4)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-control)",
                padding: "18px"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>Master Output Level</span>
                <span className="subtle-text" style={{ fontSize: "0.8rem", fontWeight: 600 }}>
                  {masterLevel > 0 ? `${masterLevel}% Output Active` : "Standing By (Play Music)"}
                </span>
              </div>

              {/* Dual Stereo VU Channels */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "0.75rem", fontWeight: 700, minWidth: "14px", color: "var(--text-secondary)" }}>L</span>
                  <div style={{ flex: 1, height: "8px", background: "rgba(255,255,255,0.08)", borderRadius: "4px", overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${leftVu}%`,
                        height: "100%",
                        background: leftVu > 85 ? "#ff4757" : leftVu > 60 ? "#ffa502" : "var(--accent-primary)",
                        transition: "width 0.08s ease"
                      }}
                    />
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "0.75rem", fontWeight: 700, minWidth: "14px", color: "var(--text-secondary)" }}>R</span>
                  <div style={{ flex: 1, height: "8px", background: "rgba(255,255,255,0.08)", borderRadius: "4px", overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${rightVu}%`,
                        height: "100%",
                        background: rightVu > 85 ? "#ff4757" : rightVu > 60 ? "#ffa502" : "var(--accent-cyan)",
                        transition: "width 0.08s ease"
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Dynamic Spectrum Wave Bars */}
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "4px", height: "30px", marginTop: "16px" }}>
                {[0.4, 0.8, 1.2, 1.6, 1.4, 0.9, 1.3, 0.7, 1.1, 1.5, 0.6, 1.2, 0.8, 1.4].map((multiplier, i) => {
                  const h = masterLevel > 0 ? Math.max(4, Math.min(30, Math.round(masterLevel * multiplier * 0.35))) : 4;
                  return (
                    <div
                      key={i}
                      style={{
                        width: "4px",
                        height: `${h}px`,
                        background: isMicOn ? "var(--accent-rose)" : "var(--accent-primary)",
                        borderRadius: "2px",
                        transition: "height 0.07s ease"
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column: QR Backstage Pass, Listeners & Room Chat */}
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* Backstage Pass QR Card */}
            <div className="content-card dj-reactive-card" style={{ padding: "24px", textAlign: "center" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "0 0 4px" }}>
                Listener Backstage Pass
              </h3>
              <p className="subtle-text" style={{ fontSize: "0.8rem", margin: "0 0 16px" }}>
                Nearby devices scan this QR code or use room code to tune in instantly
              </p>

              <div
                style={{
                  background: "#ffffff",
                  padding: "16px",
                  borderRadius: "16px",
                  display: "inline-block",
                  boxShadow: "0 8px 30px rgba(0, 0, 0, 0.4)",
                  marginBottom: "16px"
                }}
              >
                <QRCode value={joinUrl} size={150} />
              </div>

              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "8px" }}>
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: "1.15rem",
                    fontWeight: 800,
                    letterSpacing: "0.1em",
                    color: "var(--accent-primary)",
                    background: "rgba(16, 185, 129, 0.12)",
                    padding: "6px 14px",
                    borderRadius: "8px"
                  }}
                >
                  {session.roomId}
                </span>
                <button
                  type="button"
                  onClick={handleCopyInvite}
                  className="button-secondary"
                  style={{ fontSize: "0.85rem", padding: "6px 12px" }}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>

              {/* Active listeners chips */}
              <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: "1px solid var(--border-subtle)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>
                    Connected Listeners ({connectedUsers.length})
                  </span>
                  <span className="live-indicator-dot" />
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {connectedUsers.length === 0 ? (
                    <span className="subtle-text" style={{ fontSize: "0.82rem" }}>
                      Waiting for listeners to scan QR or join...
                    </span>
                  ) : (
                    connectedUsers.map((user) => (
                      <span
                        key={user.id}
                        style={{
                          fontSize: "0.78rem",
                          fontWeight: 600,
                          background: "rgba(255, 255, 255, 0.06)",
                          padding: "4px 10px",
                          borderRadius: "999px",
                          border: "1px solid var(--border-subtle)"
                        }}
                      >
                        🎧 {user.name}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Room Chat Card */}
            <div className="content-card dj-reactive-card" style={{ padding: "20px", display: "flex", flexDirection: "column", height: "360px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "8px" }}>
                <h3 style={{ margin: 0, fontSize: "1rem" }}>💬 Studio Chat</h3>
                <span className="subtle-text" style={{ fontSize: "0.75rem" }}>Live reactions</span>
              </div>

              <div
                ref={chatScrollRef}
                style={{
                  flex: 1,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  paddingRight: "4px",
                  marginBottom: "12px"
                }}
              >
                {chatMessages.length === 0 ? (
                  <p className="subtle-text" style={{ textAlign: "center", margin: "auto", fontSize: "0.82rem" }}>
                    No messages yet. Listeners can chat here while listening!
                  </p>
                ) : (
                  chatMessages.map((msg) => {
                    const isMe = msg.senderId === hostIdRef.current;
                    return (
                      <div
                        key={msg.id}
                        style={{
                          alignSelf: isMe ? "flex-end" : "flex-start",
                          maxWidth: "85%",
                          background: isMe ? "var(--accent-primary)" : "rgba(255, 255, 255, 0.08)",
                          color: isMe ? "#000" : "inherit",
                          padding: "6px 12px",
                          borderRadius: "12px",
                          fontSize: "0.85rem"
                        }}
                      >
                        <span style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, opacity: 0.8, marginBottom: "2px" }}>
                          {msg.senderName}
                        </span>
                        <p style={{ margin: 0, wordBreak: "break-word" }}>{msg.message}</p>
                      </div>
                    );
                  })
                )}
              </div>

              <form onSubmit={handleSendChat} style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  placeholder="Send a studio message..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  maxLength={200}
                  className="text-input"
                  style={{ flex: 1, padding: "8px 12px", fontSize: "0.85rem" }}
                />
                <button type="submit" className="button-primary" style={{ padding: "0 14px", fontSize: "0.85rem" }}>
                  Send
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
