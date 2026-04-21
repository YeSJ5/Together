import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
import AppShell from "../components/AppShell";
import StatusBadge from "../components/StatusBadge";
import {
  createSession,
  endSession,
  fetchSession,
  fetchSessionEvents,
  sendSessionEvent
} from "../lib/api";
import { createAppId } from "../lib/ids";
import { clearHostSession, saveHostSession } from "../lib/storage";
import { captureHostAudio, createPeerConnection } from "../lib/webrtc";

function makeHostId() {
  return createAppId("host");
}

function detectMobileHost() {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export default function HostDashboardPage() {
  const isMobileHost = detectMobileHost();
  const [audioSourceMode, setAudioSourceMode] = useState(
    isMobileHost ? "microphone" : "device-audio"
  );
  const [session, setSession] = useState(null);
  const [connectedUsers, setConnectedUsers] = useState([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Ready to start");
  const [isStarting, setIsStarting] = useState(false);
  const [audioDebug, setAudioDebug] = useState("No active capture");
  const [hostSignalDebug, setHostSignalDebug] = useState("Signaling idle");
  const [publicJoinOrigin, setPublicJoinOrigin] = useState(window.location.origin);
  const streamRef = useRef(null);
  const captureStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioAnalyserRef = useRef(null);
  const audioMeterFrameRef = useRef(null);
  const hostIdRef = useRef(makeHostId());
  const roomIdRef = useRef("");
  const peerConnectionsRef = useRef(new Map());
  const latestEventIdRef = useRef(0);
  const eventPollRef = useRef(null);
  const sessionPollRef = useRef(null);

  const joinUrl = useMemo(() => {
    if (!session) {
      return "";
    }

    return `${publicJoinOrigin}/join/${session.roomId}`;
  }, [session]);

  const canUseDeviceAudio = Boolean(navigator.mediaDevices?.getDisplayMedia);

  useEffect(() => {
    fetch("/api/runtime")
      .then((response) => response.json())
      .then((data) => {
        if (window.location.hostname === "localhost" && data.lanOrigin) {
          setPublicJoinOrigin(data.lanOrigin);
          return;
        }

        setPublicJoinOrigin(data.currentOrigin || window.location.origin);
      })
      .catch(() => {
        setPublicJoinOrigin(window.location.origin);
      });

    return () => {
      teardownLocalSession();
    };
  }, []);

  useEffect(() => {
    if (!session?.roomId) {
      return undefined;
    }

    let isCancelled = false;

    async function processEvent(event) {
      if (event.type === "listener-joined-room") {
        const listenerId = event.payload.listenerId;

        if (!streamRef.current || !roomIdRef.current) {
          return;
        }

        try {
          const peerConnection = createPeerConnection({
            onIceCandidate: (candidate) => {
              sendSessionEvent(roomIdRef.current, {
                type: "signal:ice-candidate",
                senderId: hostIdRef.current,
                targetId: listenerId,
                payload: {
                  candidate
                }
              }).catch(() => {});
            },
            onTrack: () => {}
          });

          streamRef.current.getTracks().forEach((track) => {
            peerConnection.addTrack(track, streamRef.current);
          });

          peerConnectionsRef.current.set(listenerId, peerConnection);
          const offer = await peerConnection.createOffer({
            offerToReceiveAudio: false,
            offerToReceiveVideo: false
          });
          await peerConnection.setLocalDescription(offer);

          await sendSessionEvent(roomIdRef.current, {
            type: "signal:offer",
            senderId: hostIdRef.current,
            targetId: listenerId,
            payload: {
              offer
            }
          });
        } catch (_offerError) {
          setError("Could not connect a listener to the live audio stream.");
        }
      }

      if (event.type === "signal:answer") {
        const peerConnection = peerConnectionsRef.current.get(event.senderId);

        if (peerConnection) {
          await peerConnection.setRemoteDescription(event.payload.answer);
        }
      }

      if (event.type === "signal:ice-candidate" && event.payload.candidate) {
        const peerConnection = peerConnectionsRef.current.get(event.senderId);

        if (peerConnection) {
          await peerConnection.addIceCandidate(event.payload.candidate);
        }
      }

      if (event.type === "listener-disconnected") {
        const peerConnection = peerConnectionsRef.current.get(event.payload.listenerId);

        if (peerConnection) {
          peerConnection.close();
          peerConnectionsRef.current.delete(event.payload.listenerId);
        }
      }
    }

    async function pollEvents() {
      try {
        const data = await fetchSessionEvents(
          session.roomId,
          hostIdRef.current,
          latestEventIdRef.current
        );

        for (const event of data.events || []) {
          latestEventIdRef.current = Math.max(latestEventIdRef.current, event.id);
          await processEvent(event);
        }

        setHostSignalDebug("Polling signaling active");
      } catch (pollError) {
        if (!isCancelled) {
          setHostSignalDebug(`Polling error: ${pollError.message}`);
        }
      } finally {
        if (!isCancelled) {
          eventPollRef.current = setTimeout(pollEvents, 1000);
        }
      }
    }

    async function pollSessionState() {
      try {
        const latestSession = await fetchSession(session.roomId);

        if (!isCancelled) {
          setConnectedUsers(latestSession.users || []);
        }
      } catch (pollError) {
        if (!isCancelled) {
          setHostSignalDebug(`Session error: ${pollError.message}`);
        }
      } finally {
        if (!isCancelled) {
          sessionPollRef.current = setTimeout(pollSessionState, 2000);
        }
      }
    }

    pollEvents();
    pollSessionState();

    return () => {
      isCancelled = true;

      if (eventPollRef.current) {
        clearTimeout(eventPollRef.current);
      }

      if (sessionPollRef.current) {
        clearTimeout(sessionPollRef.current);
      }
    };
  }, [session]);

  function teardownLocalSession() {
    peerConnectionsRef.current.forEach((peer) => peer.close());
    peerConnectionsRef.current.clear();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (captureStreamRef.current) {
      captureStreamRef.current.getTracks().forEach((track) => track.stop());
      captureStreamRef.current = null;
    }

    if (audioMeterFrameRef.current) {
      cancelAnimationFrame(audioMeterFrameRef.current);
      audioMeterFrameRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
      audioAnalyserRef.current = null;
    }

    if (eventPollRef.current) {
      clearTimeout(eventPollRef.current);
      eventPollRef.current = null;
    }

    if (sessionPollRef.current) {
      clearTimeout(sessionPollRef.current);
      sessionPollRef.current = null;
    }

    clearHostSession();
    roomIdRef.current = "";
    latestEventIdRef.current = 0;
    setSession(null);
    setConnectedUsers([]);
    setAudioDebug("No active capture");
    setHostSignalDebug("Signaling idle");
  }

  function startAudioDiagnostics(mediaStream) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) {
        setAudioDebug("Audio capture active, but browser meter is unavailable");
        return;
      }

      const audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(mediaStream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const samples = new Uint8Array(analyser.frequencyBinCount);
      audioContextRef.current = audioContext;
      audioAnalyserRef.current = analyser;

      const tick = () => {
        if (!audioAnalyserRef.current) {
          return;
        }

        audioAnalyserRef.current.getByteFrequencyData(samples);
        const average =
          samples.reduce((total, value) => total + value, 0) / samples.length;

        if (average > 4) {
          setAudioDebug(`Audio detected (${Math.round(average)} level)`);
        } else {
          setAudioDebug("Capture connected, but no audible signal detected yet");
        }

        audioMeterFrameRef.current = requestAnimationFrame(tick);
      };

      tick();
    } catch (_diagnosticError) {
      setAudioDebug("Audio capture active, diagnostics unavailable");
    }
  }

  async function handleStartSession() {
    setIsStarting(true);
    setError("");
    setStatus("Requesting audio permission");
    let createdSession = null;

    try {
      if (
        audioSourceMode === "device-audio" &&
        !navigator.mediaDevices?.getDisplayMedia
      ) {
        throw new Error(
          "This browser does not support device audio capture. Use latest Chrome or Edge."
        );
      }

      if (isMobileHost && audioSourceMode === "device-audio") {
        throw new Error(
          "Use Microphone mode when hosting from a phone. Mobile browsers do not reliably support device or tab audio sharing."
        );
      }

      createdSession = await createSession({
        hostId: hostIdRef.current,
        audioSourceMode
      });

      const mediaStream = await captureHostAudio(audioSourceMode);
      captureStreamRef.current = mediaStream;
      const audioTracks = mediaStream.getAudioTracks();

      if (audioTracks.length === 0) {
        throw new Error(
          "No audio track was shared. Make sure you choose a tab or window with audio enabled."
        );
      }

      streamRef.current = new MediaStream(audioTracks);
      startAudioDiagnostics(streamRef.current);
      roomIdRef.current = createdSession.roomId;
      setSession(createdSession);
      saveHostSession({
        roomId: createdSession.roomId,
        hostId: hostIdRef.current
      });
      setStatus("Waiting for listeners");
      setHostSignalDebug("Host polling ready");

      audioTracks[0].addEventListener("ended", () => {
        setStatus("Audio share stopped");
        setAudioDebug("Audio track ended");
      });
    } catch (startError) {
      if (createdSession?.roomId) {
        try {
          await endSession(createdSession.roomId);
        } catch (_cleanupError) {
          // Ignore cleanup failures after a partially created session.
        }
      }

      setError(startError.message || "Unable to start sharing.");
      setStatus("Share failed");
    } finally {
      setIsStarting(false);
    }
  }

  async function handleEndSession() {
    if (!session) {
      return;
    }

    try {
      await endSession(session.roomId);
    } catch (endError) {
      setError(endError.message || "Could not end the session cleanly.");
    } finally {
      teardownLocalSession();
      setStatus("Session ended");
    }
  }

  return (
    <AppShell>
      <section className="dashboard-grid">
        <article className="content-card large-card fade-in">
          <div className="section-header">
            <div>
              <p className="eyebrow">Host dashboard</p>
              <h1>Broadcast your live audio</h1>
            </div>
            <StatusBadge tone={session ? "success" : "neutral"}>{status}</StatusBadge>
          </div>

          <div className="source-toggle">
            <button
              type="button"
              className={audioSourceMode === "device-audio" ? "chip active" : "chip"}
              onClick={() => setAudioSourceMode("device-audio")}
              disabled={!canUseDeviceAudio}
            >
              Device Audio
            </button>
            <button
              type="button"
              className={audioSourceMode === "microphone" ? "chip active" : "chip"}
              onClick={() => setAudioSourceMode("microphone")}
            >
              Microphone
            </button>
          </div>

          <p className="subtle-text">
            Device Audio uses browser-supported system or tab audio capture. The
            browser may still show a picker internally, but the app UI stays focused
            on audio sharing.
          </p>
          {isMobileHost ? (
            <p className="subtle-text">
              Hosting from a phone works best in <strong>Microphone</strong> mode.
              Mobile browsers usually cannot share device audio output reliably.
            </p>
          ) : null}

          <div className="button-row">
            <button
              type="button"
              className="button-primary"
              onClick={handleStartSession}
              disabled={Boolean(session) || isStarting}
            >
              {isStarting ? "Starting..." : "Start Sharing Session"}
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={handleEndSession}
              disabled={!session}
            >
              End Session
            </button>
          </div>

          {error ? <p className="error-banner">{error}</p> : null}
        </article>

        <article className="content-card slide-up">
          <h2>Session Access</h2>
          {session ? (
            <div className="qr-stack">
              <div className="qr-card">
                <QRCode value={joinUrl} size={180} />
              </div>
              <p className="info-line">
                <strong>Room ID:</strong> {session.roomId}
              </p>
              <p className="join-url">{joinUrl}</p>
            </div>
          ) : (
            <p className="empty-state">
              Start a session to generate the room, QR code, and join link.
            </p>
          )}
        </article>

        <article className="content-card slide-up">
          <h2>Connected listeners</h2>
          <p className="listener-count">{connectedUsers.length}</p>
          <p className="subtle-text">{audioDebug}</p>
          <p className="subtle-text">{hostSignalDebug}</p>
          <div className="listener-list">
            {connectedUsers.length === 0 ? (
              <p className="empty-state">No listeners yet.</p>
            ) : (
              connectedUsers.map((user) => (
                <div key={user.id} className="listener-pill">
                  {user.username}
                </div>
              ))
            )}
          </div>
        </article>
      </section>
    </AppShell>
  );
}
