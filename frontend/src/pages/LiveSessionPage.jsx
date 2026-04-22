import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import StatusBadge from "../components/StatusBadge";
import {
  fetchSession,
  fetchSessionEvents,
  joinSession,
  leaveSession,
  sendSessionEvent
} from "../lib/api";
import {
  disableNativeBackgroundPlayback,
  enableNativeBackgroundPlayback,
  isNativeAndroidApp
} from "../lib/nativeAudio";
import { sanitizeChatMessage } from "../lib/sanitize";
import { clearListenerSession, getListenerSession } from "../lib/storage";
import { useNavigationLock } from "../lib/useNavigationLock";
import { createPeerConnection } from "../lib/webrtc";

export default function LiveSessionPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const audioRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const pollingRef = useRef(null);
  const roomPollRef = useRef(null);
  const latestEventIdRef = useRef(0);
  const wakeLockRef = useRef(null);
  const connectedRef = useRef(false);
  const awaitingGestureRef = useRef(false);
  const hiddenRef = useRef(false);
  const [status, setStatus] = useState("Connecting");
  const [error, setError] = useState("");
  const [volume, setVolume] = useState(100);
  const [connected, setConnected] = useState(false);
  const [diagnostics, setDiagnostics] = useState(["Opening listener session"]);
  const [awaitingGesture, setAwaitingGesture] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [roomSnapshot, setRoomSnapshot] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatAudience, setChatAudience] = useState("everyone");
  const [sessionNote, setSessionNote] = useState(
    "Stay on this page until the stream starts. On many phones, live browser audio is most reliable while the app stays visible."
  );
  const [isLeaving, setIsLeaving] = useState(false);

  useNavigationLock(
    !isLeaving && status !== "Session ended" && status !== "Unavailable",
    "Leave the current listening session before navigating away."
  );

  function pushDiagnostic(message) {
    setDiagnostics((current) => [...current, message].slice(-10));
  }

  function updateConnected(nextConnected) {
    connectedRef.current = nextConnected;
    setConnected(nextConnected);
  }

  function updateAwaitingGesture(nextAwaitingGesture) {
    awaitingGestureRef.current = nextAwaitingGesture;
    setAwaitingGesture(nextAwaitingGesture);
  }

  function pushChatMessage(message) {
    setChatMessages((current) => [...current, message].slice(-20));
  }

  async function attemptPlaybackResume(reason) {
    if (!audioRef.current?.srcObject || awaitingGestureRef.current) {
      return;
    }

    try {
      await audioRef.current.play();
      syncMediaSession("playing");
      pushDiagnostic(`Playback confirmed: ${reason}`);
    } catch (_error) {
      pushDiagnostic(`Playback resume blocked: ${reason}`);
    }
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator) || wakeLockRef.current) {
      return;
    }

    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      pushDiagnostic("Screen wake lock enabled");
    } catch (_error) {
      pushDiagnostic("Wake lock unavailable on this device");
    }
  }

  async function releaseWakeLock() {
    if (!wakeLockRef.current) {
      return;
    }

    await wakeLockRef.current.release().catch(() => {});
    wakeLockRef.current = null;
    pushDiagnostic("Screen wake lock released");
  }

  function syncMediaSession(nextStatus) {
    if (!("mediaSession" in navigator)) {
      return;
    }

    if ("MediaMetadata" in window) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "TOGETHER Live Audio",
        artist: `Room ${roomId}`,
        album: "Listen Together. Instantly."
      });
    }

    navigator.mediaSession.playbackState = nextStatus === "playing" ? "playing" : "paused";

    try {
      navigator.mediaSession.setActionHandler("play", () => {
        handleManualPlay();
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        audioRef.current?.pause();
      });
    } catch (_error) {
      pushDiagnostic("Media controls unavailable");
    }
  }

  useEffect(() => {
    const listener = getListenerSession();

    if (!listener || listener.roomId !== roomId) {
      navigate(`/join/${roomId}`);
      return undefined;
    }

    if (!window.RTCPeerConnection) {
      setError("This browser does not support WebRTC audio streaming.");
      return undefined;
    }

    requestWakeLock();
    if (isNativeAndroidApp()) {
      enableNativeBackgroundPlayback().catch(() => {});
    }
    pushDiagnostic("Listener ready");

    const peerConnection = createPeerConnection({
      onIceCandidate: (candidate) => {
        sendSessionEvent(roomId, {
          type: "signal:ice-candidate",
          senderId: listener.listenerId,
          targetId: listener.hostId,
          payload: {
            candidate
          }
        }).catch(() => {});
      },
      onTrack: async (stream) => {
        if (!audioRef.current) {
          return;
        }

        audioRef.current.srcObject = stream;
        pushDiagnostic("Audio track received on listener");
        setStatus("Ready to play");
        setSessionNote("The host audio reached your device. If playback does not start, tap the play button once.");

        try {
          await audioRef.current.play();
          updateConnected(true);
          setError("");
          setStatus("Live");
          updateAwaitingGesture(false);
          setSessionNote(
            "Connected. If playback pauses after app switching, return to this page and tap play once."
          );
          syncMediaSession("playing");
          pushDiagnostic("Playback started successfully");
        } catch (_playbackError) {
          setStatus("Tap play to start audio");
          updateAwaitingGesture(true);
          setSessionNote("Your phone wants a tap before live audio can start. Tap the button once to continue.");
          syncMediaSession("paused");
          pushDiagnostic("Playback blocked until user taps play");
        }
      }
    });

    peerConnectionRef.current = peerConnection;
    peerConnection.onconnectionstatechange = () => {
      const nextState = peerConnection.connectionState;
      pushDiagnostic(`Peer connection: ${nextState}`);

        if (nextState === "connected") {
          updateConnected(true);
          setError("");
          setStatus("Connected");
          setSessionNote(
            "Connected to the host. Waiting for the audio stream to begin."
          );
        }

      if (nextState === "failed") {
        setError("Peer connection failed on this device. Try rejoining the session.");
        setSessionNote("The connection could not be completed on this device.");
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      pushDiagnostic(`ICE state: ${peerConnection.iceConnectionState}`);
    };

    async function pollEvents() {
      try {
        const data = await fetchSessionEvents(
          roomId,
          listener.listenerId,
          latestEventIdRef.current
        );

        for (const event of data.events || []) {
          latestEventIdRef.current = Math.max(latestEventIdRef.current, event.id);

          if (event.type === "signal:offer") {
            pushDiagnostic("Offer received from host");
            await peerConnection.setRemoteDescription(event.payload.offer);
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            setStatus("Negotiating audio");
            setSessionNote("Securely connecting your device to the host stream.");
            pushDiagnostic("Answer created and sent");

            await sendSessionEvent(roomId, {
              type: "signal:answer",
              senderId: listener.listenerId,
              targetId: listener.hostId,
              payload: {
                answer
              }
            });
          }

          if (event.type === "signal:ice-candidate" && event.payload.candidate) {
            await peerConnection.addIceCandidate(event.payload.candidate);
            pushDiagnostic("ICE candidate added");
          }

          if (event.type === "chat-message") {
            pushChatMessage({
              id: `${event.id}-${event.senderId}`,
              senderName: event.payload.username || "Participant",
              audience: event.targetId ? "Host only" : "Everyone",
              message: event.payload.message
            });
          }
        }

        const nextPollDelay = connectedRef.current ? (hiddenRef.current ? 10000 : 5000) : 1200;
        pollingRef.current = setTimeout(pollEvents, nextPollDelay);
      } catch (pollError) {
        if (String(pollError.message || "").includes("Session not found")) {
          updateConnected(false);
          setStatus("Session ended");
          setError("The host session is no longer available.");
          setSessionNote("This room is no longer active.");
          clearListenerSession();
          return;
        }

        setStatus("Network issue");
        pushDiagnostic(`Polling error: ${pollError.message}`);
        if (!connectedRef.current) {
          setError("Phone could not connect to the live signaling server. Retry the session.");
          setSessionNote("The app is trying to reconnect to the host.");
        } else {
          setError("");
          setSessionNote("Audio is live. Connection checks are retrying quietly in the background.");
        }
        const retryDelay = connectedRef.current ? (hiddenRef.current ? 12000 : 6000) : 1800;
        pollingRef.current = setTimeout(pollEvents, retryDelay);
      }
    }

    async function startListener() {
      setStatus("Joining room");
      setSessionNote("Joining the host room and waiting for the live audio stream.");
      pushDiagnostic("Joining room");
      const initialRoom = await fetchSession(roomId);
      setRoomSnapshot(initialRoom);
      await joinSession(roomId, {
        listenerId: listener.listenerId,
        username: listener.username
      });
      pushDiagnostic("Listener registered");
      pollEvents();
    }

    startListener().catch((joinError) => {
      setError(joinError.message || "Unable to join the session.");
      setStatus("Unavailable");
      setSessionNote("This device could not join the room.");
      pushDiagnostic(`Join failed: ${joinError.message}`);
    });

    async function pollRoomState() {
      try {
        const latestRoom = await fetchSession(roomId);
        if (!isCancelled) {
          setRoomSnapshot(latestRoom);
        }
      } catch (_error) {
        // Session polling is best-effort here.
      } finally {
        if (!isCancelled) {
          roomPollRef.current = window.setTimeout(pollRoomState, 3000);
        }
      }
    }

    pollRoomState();

    function handleVisibilityChange() {
      hiddenRef.current = document.visibilityState !== "visible";

      if (document.visibilityState === "hidden") {
        syncMediaSession("playing");
        attemptPlaybackResume("app moved to background");
        return;
      }

      if (document.visibilityState === "visible") {
        requestWakeLock();
        attemptPlaybackResume("app returned to foreground");
      }
    }

    function handlePageShow() {
      requestWakeLock();
      attemptPlaybackResume("page restored");
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);

      if (pollingRef.current) {
        clearTimeout(pollingRef.current);
      }

      if (roomPollRef.current) {
        clearTimeout(roomPollRef.current);
      }

      leaveSession(roomId, {
        listenerId: listener.listenerId
      }).catch(() => {});

      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }

      if (wakeLockRef.current) {
        releaseWakeLock().catch(() => {});
      }

      if (isNativeAndroidApp()) {
        disableNativeBackgroundPlayback().catch(() => {});
      }
    };
  }, [navigate, roomId]);

  function handleVolumeChange(event) {
    const nextVolume = Number(event.target.value);
    setVolume(nextVolume);

    if (audioRef.current) {
      audioRef.current.volume = nextVolume / 100;
    }
  }

  async function handleManualPlay() {
    if (!audioRef.current) {
      return;
    }

    try {
      await audioRef.current.play();
      updateConnected(true);
      setError("");
      setStatus("Live");
      updateAwaitingGesture(false);
      setSessionNote("Connected. Your device is now playing the host audio.");
      syncMediaSession("playing");
      pushDiagnostic("Manual play succeeded");
    } catch (_playError) {
      setError("Audio playback is blocked. Please allow media playback in your browser.");
      setSessionNote("Your browser is still blocking live audio playback.");
      syncMediaSession("paused");
      pushDiagnostic("Manual play failed");
    }
  }

  async function handleLeaveRoom() {
    const listener = getListenerSession();

    setIsLeaving(true);

    if (listener?.roomId === roomId) {
      await leaveSession(roomId, {
        listenerId: listener.listenerId
      }).catch(() => {});
    }

    clearListenerSession();
    navigate(`/join/${roomId}`);
  }

  async function handleSendChat() {
    const listener = getListenerSession();

    if (!listener) {
      return;
    }

    const message = sanitizeChatMessage(chatInput);

    if (!message) {
      return;
    }
    const targetId = chatAudience === "host" ? roomSnapshot?.hostId || listener.hostId : null;

    try {
      await sendSessionEvent(roomId, {
        type: "chat-message",
        senderId: listener.listenerId,
        targetId,
        payload: {
          username: listener.username || "Guest Listener",
          message
        }
      });

      pushChatMessage({
        id: `local-${Date.now()}`,
        senderName: listener.username || "Guest Listener",
        audience: targetId ? "Host only" : "Everyone",
        message
      });
      setChatInput("");
    } catch (_error) {
      setError("Message could not be sent.");
    }
  }

  const participantList = roomSnapshot
    ? [
        {
          id: roomSnapshot.hostId,
          username: roomSnapshot.hostName || "Host",
          role: "Host"
        },
        ...(roomSnapshot.users || []).map((user) => ({
          ...user,
          role: "Listener"
        }))
      ]
    : [];

  return (
    <AppShell
      lockNavigation={!isLeaving && status !== "Session ended" && status !== "Unavailable"}
      lockLabel="Leave the room before navigating"
    >
      <section className="center-card fade-in">
        <StatusBadge tone={connected ? "success" : "warning"}>{status}</StatusBadge>
        <h1>Live Session</h1>
        <p className="hero-text compact">
          Room <strong>{roomId}</strong> is connected to the shared audio session.
        </p>
        <p className="subtle-text listener-note">{sessionNote}</p>

        {error ? <p className="error-banner">{error}</p> : null}

        <audio
          ref={audioRef}
          autoPlay
          playsInline
          controls
          className="debug-audio-player"
          onPause={() => {
            if (connectedRef.current && !awaitingGestureRef.current && hiddenRef.current) {
              attemptPlaybackResume("audio paused in background");
            }
          }}
        />

        <div className="player-card">
          <button type="button" className="button-primary large-button" onClick={handleManualPlay}>
            {awaitingGesture ? "Tap To Enable Audio" : "Play Audio"}
          </button>
          <button
            type="button"
            className="button-secondary large-button"
            onClick={handleLeaveRoom}
          >
            Leave Session
          </button>
          <label className="volume-stack" htmlFor="volume">
            Volume
            <input
              id="volume"
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={handleVolumeChange}
            />
          </label>
          <button
            type="button"
            className="button-secondary diagnostics-toggle"
            onClick={() => setShowDiagnostics((current) => !current)}
          >
            {showDiagnostics ? "Hide Tech Details" : "Stats for Nerds"}
          </button>
          {showDiagnostics ? (
            <div className="diagnostic-card">
              <strong>Connection details</strong>
              {diagnostics.map((item, index) => (
                <p key={`${item}-${index}`} className="diagnostic-line">
                  {item}
                </p>
              ))}
            </div>
          ) : null}

          <div className="participant-section">
            <strong>People in this room</strong>
            <div className="listener-list">
              {participantList.length === 0 ? (
                <p className="empty-state">Room members will appear here.</p>
              ) : (
                participantList.map((user) => (
                  <div key={user.id} className="listener-pill participant-pill">
                    <span>{user.username}</span>
                    <strong>{user.role}</strong>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="participant-section">
            <strong>Room chat</strong>
            <div className="chat-feed">
              {chatMessages.length === 0 ? (
                <p className="empty-state">Messages shared in this room will appear here.</p>
              ) : (
                chatMessages.map((message) => (
                  <div key={message.id} className="chat-bubble">
                    <div className="chat-meta">
                      <strong>{message.senderName}</strong>
                      <span>{message.audience}</span>
                    </div>
                    <p>{message.message}</p>
                  </div>
                ))
              )}
            </div>
            <div className="chat-compose">
              <select
                className="text-input chat-select"
                value={chatAudience}
                onChange={(event) => setChatAudience(event.target.value)}
              >
                <option value="everyone">Message everyone</option>
                <option value="host">Message host only</option>
              </select>
              <input
                className="text-input"
                placeholder="Send a message"
                value={chatInput}
                maxLength={220}
                onChange={(event) => setChatInput(event.target.value)}
              />
              <button type="button" className="button-primary" onClick={handleSendChat}>
                Send
              </button>
            </div>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
