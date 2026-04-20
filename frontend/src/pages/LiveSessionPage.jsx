import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import StatusBadge from "../components/StatusBadge";
import {
  fetchSessionEvents,
  joinSession,
  leaveSession,
  sendSessionEvent
} from "../lib/api";
import { clearListenerSession, getListenerSession } from "../lib/storage";
import { createPeerConnection } from "../lib/webrtc";

export default function LiveSessionPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const audioRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const pollingRef = useRef(null);
  const latestEventIdRef = useRef(0);
  const [status, setStatus] = useState("Connecting");
  const [error, setError] = useState("");
  const [volume, setVolume] = useState(100);
  const [connected, setConnected] = useState(false);
  const [diagnostics, setDiagnostics] = useState(["Opening listener session"]);
  const [awaitingGesture, setAwaitingGesture] = useState(false);

  function pushDiagnostic(message) {
    setDiagnostics((current) => [...current, message].slice(-6));
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

    pushDiagnostic("Polling listener created");

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
        setStatus("Audio received");

        try {
          await audioRef.current.play();
          setConnected(true);
          setStatus("Live");
          setAwaitingGesture(false);
          pushDiagnostic("Playback started successfully");
        } catch (_playbackError) {
          setStatus("Tap play to start audio");
          setAwaitingGesture(true);
          pushDiagnostic("Playback blocked until user taps play");
        }
      }
    });

    peerConnectionRef.current = peerConnection;
    peerConnection.onconnectionstatechange = () => {
      const nextState = peerConnection.connectionState;
      pushDiagnostic(`Peer connection: ${nextState}`);

      if (nextState === "connected") {
        setConnected(true);
      }

      if (nextState === "failed") {
        setError("Peer connection failed on this device. Try rejoining the session.");
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
        }

        pollingRef.current = setTimeout(pollEvents, 1200);
      } catch (pollError) {
        if (String(pollError.message || "").includes("Session not found")) {
          setConnected(false);
          setStatus("Session ended");
          setError("The host session is no longer available.");
          clearListenerSession();
          return;
        }

        setStatus("Network issue");
        pushDiagnostic(`Polling error: ${pollError.message}`);
        setError("Phone could not connect to the live signaling server. Retry the session.");
        pollingRef.current = setTimeout(pollEvents, 1800);
      }
    }

    async function startListener() {
      setStatus("Joining room");
      pushDiagnostic("Joining room by polling");
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
      pushDiagnostic(`Join failed: ${joinError.message}`);
    });

    return () => {
      if (pollingRef.current) {
        clearTimeout(pollingRef.current);
      }

      leaveSession(roomId, {
        listenerId: listener.listenerId
      }).catch(() => {});

      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
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
      setConnected(true);
      setStatus("Live");
      setAwaitingGesture(false);
      pushDiagnostic("Manual play succeeded");
    } catch (_playError) {
      setError("Audio playback is blocked. Please allow media playback in your browser.");
      pushDiagnostic("Manual play failed");
    }
  }

  return (
    <AppShell>
      <section className="center-card fade-in">
        <StatusBadge tone={connected ? "success" : "warning"}>{status}</StatusBadge>
        <h1>Live Session</h1>
        <p className="hero-text compact">
          Room <strong>{roomId}</strong> is receiving the shared audio stream. For the
          best experience, keep this page open and use earbuds on mobile.
        </p>

        {error ? <p className="error-banner">{error}</p> : null}

        <audio ref={audioRef} autoPlay playsInline controls className="debug-audio-player" />

        <div className="player-card">
          <button type="button" className="button-primary large-button" onClick={handleManualPlay}>
            {awaitingGesture ? "Tap To Enable Audio" : "Play Audio"}
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
          <div className="diagnostic-card">
            <strong>Listener diagnostics</strong>
            {diagnostics.map((item, index) => (
              <p key={`${item}-${index}`} className="diagnostic-line">
                {item}
              </p>
            ))}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
