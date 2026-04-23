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
import { getNativeAudioCapabilities, isNativeAndroidApp, startNativeSystemAudioBridge } from "../lib/nativeAudio";
import { sanitizeChatMessage, sanitizeDisplayName } from "../lib/sanitize";
import { clearHostSession, saveHostSession } from "../lib/storage";
import { useNavigationLock } from "../lib/useNavigationLock";
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
  const [hostName, setHostName] = useState("Host");
  const [audioSourceMode, setAudioSourceMode] = useState(
    isMobileHost ? "microphone" : "device-audio"
  );
  const [selectedAudioFile, setSelectedAudioFile] = useState(null);
  const [session, setSession] = useState(null);
  const [connectedUsers, setConnectedUsers] = useState([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Ready to start");
  const [isStarting, setIsStarting] = useState(false);
  const [audioDebug, setAudioDebug] = useState("No active capture");
  const [hostSignalDebug, setHostSignalDebug] = useState("Signaling idle");
  const [publicJoinOrigin, setPublicJoinOrigin] = useState(window.location.origin);
  const [showHostDetails, setShowHostDetails] = useState(false);
  const [copiedState, setCopiedState] = useState("");
  const [recentActivity, setRecentActivity] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [nativeCapabilities, setNativeCapabilities] = useState({
    nativeAndroid: false,
    systemAudioCapture: false
  });
  const [activeTab, setActiveTab] = useState("studio");
  const streamRef = useRef(null);
  const captureStreamRef = useRef(null);
  const nativeCaptureRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioAnalyserRef = useRef(null);
  const audioMeterFrameRef = useRef(null);
  const fileAudioElementRef = useRef(null);
  const fileAudioUrlRef = useRef(null);
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

  const participantList = useMemo(() => {
    if (!session) {
      return [];
    }

    return [
      {
        id: session.hostId,
        username: session.hostName || hostName || "Host",
        role: "Host"
      },
      ...connectedUsers.map((user) => ({
        ...user,
        role: "Listener"
      }))
    ];
  }, [connectedUsers, hostName, session]);

  const canUseDeviceAudio =
    nativeCapabilities.systemAudioCapture || Boolean(navigator.mediaDevices?.getDisplayMedia);

  useNavigationLock(
    Boolean(session),
    "End the current session before leaving this page."
  );

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

    getNativeAudioCapabilities()
      .then((capabilities) => {
        setNativeCapabilities(capabilities);

        if (isMobileHost && capabilities.systemAudioCapture) {
          setAudioSourceMode("device-audio");
        }
      })
      .catch(() => {});

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
        const displayName = event.payload.username || "Listener";

        pushActivity(`${displayName} joined the room`);

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
        const disconnectedUser = connectedUsers.find(
          (user) => user.id === event.payload.listenerId
        );
        const peerConnection = peerConnectionsRef.current.get(event.payload.listenerId);

        pushActivity(`${disconnectedUser?.username || "A listener"} left the room`);

        if (peerConnection) {
          peerConnection.close();
          peerConnectionsRef.current.delete(event.payload.listenerId);
        }
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

    if (nativeCaptureRef.current) {
      nativeCaptureRef.current.stop().catch(() => {});
      nativeCaptureRef.current = null;
    }

    if (fileAudioElementRef.current) {
      fileAudioElementRef.current.pause();
      fileAudioElementRef.current.src = "";
      fileAudioElementRef.current = null;
    }

    if (fileAudioUrlRef.current) {
      URL.revokeObjectURL(fileAudioUrlRef.current);
      fileAudioUrlRef.current = null;
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
    setRecentActivity([]);
    setChatMessages([]);
  }

  function pushActivity(message) {
    setRecentActivity((current) => [message, ...current].slice(0, 5));
  }

  function pushChatMessage(message) {
    setChatMessages((current) => {
      if (current.some((item) => item.id === message.id)) {
        return current;
      }

      return [...current, message].slice(-20);
    });
  }

  async function createFileStream(file) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error("This browser cannot stream a local audio file as a live source.");
    }

    if (fileAudioUrlRef.current) {
      URL.revokeObjectURL(fileAudioUrlRef.current);
      fileAudioUrlRef.current = null;
    }

    const objectUrl = URL.createObjectURL(file);
    fileAudioUrlRef.current = objectUrl;

    const audio = new Audio();
    audio.src = objectUrl;
    audio.preload = "auto";
    audio.controls = false;
    audio.playsInline = true;
    audio.loop = false;

    await new Promise((resolve, reject) => {
      const handleReady = () => {
        audio.removeEventListener("loadedmetadata", handleReady);
        audio.removeEventListener("error", handleError);
        resolve();
      };

      const handleError = () => {
        audio.removeEventListener("loadedmetadata", handleReady);
        audio.removeEventListener("error", handleError);
        reject(new Error("The selected file could not be opened for streaming."));
      };

      audio.addEventListener("loadedmetadata", handleReady);
      audio.addEventListener("error", handleError);
    });

    const audioContext = new AudioContextClass();
    await audioContext.resume();
    const source = audioContext.createMediaElementSource(audio);
    const destination = audioContext.createMediaStreamDestination();
    source.connect(destination);
    source.connect(audioContext.destination);

    fileAudioElementRef.current = audio;
    captureStreamRef.current = destination.stream;
    await audio.play();

    audio.addEventListener("ended", () => {
      setStatus("Source finished");
      setAudioDebug("The hosted audio file has finished playing");
    });

    return {
      captureStream: destination.stream,
      playbackContext: audioContext
    };
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
        if (!nativeCapabilities.systemAudioCapture) {
          throw new Error(
            "Phone browsers do not reliably support device or tab audio sharing here. Install the Android app for native device audio, or use Microphone or Audio File mode."
          );
        }
      }

      if (audioSourceMode === "audio-file" && !selectedAudioFile) {
        throw new Error("Choose an audio file before starting the session.");
      }

      createdSession = await createSession({
        hostId: hostIdRef.current,
        hostName: sanitizeDisplayName(hostName, "Host"),
        audioSourceMode
      });

      let mediaStream;

      if (audioSourceMode === "device-audio" && nativeCapabilities.systemAudioCapture) {
        const nativeCapture = await startNativeSystemAudioBridge();
        nativeCaptureRef.current = nativeCapture;
        mediaStream = nativeCapture.stream;
        captureStreamRef.current = mediaStream;
      } else if (audioSourceMode === "audio-file") {
        const fileSource = await createFileStream(selectedAudioFile);
        mediaStream = fileSource.captureStream;
        audioContextRef.current = fileSource.playbackContext;
      } else {
        mediaStream = await captureHostAudio(audioSourceMode);
        captureStreamRef.current = mediaStream;
      }

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

  async function handleCopyJoinLink() {
    if (!joinUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopiedState("Link copied");
    } catch (_error) {
      setCopiedState("Copy failed");
    }
  }

  async function handleShareJoinLink() {
    if (!joinUrl || !navigator.share) {
      return;
    }

    try {
      await navigator.share({
        title: "Join my TOGETHER session",
        text: `Listen together in room ${session?.roomId}`,
        url: joinUrl
      });
    } catch (_error) {
      // Ignore share cancellations.
    }
  }

  async function handleSendChat() {
    if (!session) {
      return;
    }

    const message = sanitizeChatMessage(chatInput);

    if (!message) {
      return;
    }

    try {
      await sendSessionEvent(session.roomId, {
        type: "chat-message",
        senderId: hostIdRef.current,
        payload: {
          username: sanitizeDisplayName(session.hostName || hostName, "Host"),
          message
        }
      });

      setChatInput("");
    } catch (_error) {
      setError("Message could not be sent.");
    }
  }

  return (
    <AppShell
      lockNavigation={Boolean(session)}
      lockLabel="Finish or end the live session first"
    >
      <section className="workspace-grid">
        <article className="content-card workspace-main fade-in">
          <div className="section-header">
            <div>
              <p className="eyebrow">Host dashboard</p>
              <h1>Broadcast your live audio</h1>
            </div>
            <StatusBadge tone={session ? "success" : "neutral"}>{status}</StatusBadge>
          </div>

          <div className="workspace-hero">
            <div className="workspace-kpis">
              <div className="workspace-stat">
                <span>Room</span>
                <strong>{session?.roomId || "Not live"}</strong>
              </div>
              <div className="workspace-stat">
                <span>Listeners</span>
                <strong>{connectedUsers.length}</strong>
              </div>
              <div className="workspace-stat">
                <span>Mode</span>
                <strong>
                  {audioSourceMode === "device-audio"
                    ? "Device Audio"
                    : audioSourceMode === "audio-file"
                      ? "Audio File"
                      : "Microphone"}
                </strong>
              </div>
            </div>
            <div className="button-row workspace-actions">
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
          </div>

          {error ? <p className="error-banner">{error}</p> : null}

          <div className="app-tabs" role="tablist" aria-label="Host sections">
            <button
              type="button"
              className={activeTab === "studio" ? "app-tab active" : "app-tab"}
              onClick={() => setActiveTab("studio")}
            >
              Studio
            </button>
            <button
              type="button"
              className={activeTab === "people" ? "app-tab active" : "app-tab"}
              onClick={() => setActiveTab("people")}
            >
              People
            </button>
            <button
              type="button"
              className={activeTab === "chat" ? "app-tab active" : "app-tab"}
              onClick={() => setActiveTab("chat")}
            >
              Chat
            </button>
          </div>

          {activeTab === "studio" ? (
            <div className="app-panel">
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
                <button
                  type="button"
                  className={audioSourceMode === "audio-file" ? "chip active" : "chip"}
                  onClick={() => setAudioSourceMode("audio-file")}
                >
                  Audio File
                </button>
              </div>

              <input
                className="text-input"
                placeholder="Host name"
                value={hostName}
                maxLength={32}
                onChange={(event) => setHostName(sanitizeDisplayName(event.target.value, ""))}
                disabled={Boolean(session)}
              />

              <p className="subtle-text">
                Start a room, share audio clearly, and keep everyone in sync without needing to hunt through the page.
              </p>

              {audioSourceMode === "audio-file" ? (
                <div className="file-host-panel">
                  <label className="file-picker" htmlFor="audio-file-input">
                    Choose audio file
                  </label>
                  <input
                    id="audio-file-input"
                    className="file-input"
                    type="file"
                    accept="audio/*"
                    onChange={(event) => {
                      setSelectedAudioFile(event.target.files?.[0] || null);
                    }}
                  />
                  <p className="subtle-text">
                    Best mobile fallback: pick a song, lecture clip, or podcast file from your phone and TOGETHER will stream it live to listeners.
                  </p>
                  <p className="subtle-text">
                    {selectedAudioFile
                      ? `Selected file: ${selectedAudioFile.name}`
                      : "No audio file selected yet."}
                  </p>
                </div>
              ) : null}

              {isMobileHost ? (
                <p className="subtle-text">
                  Hosting from a phone works best in <strong>Microphone</strong> or <strong>Audio File</strong> mode.
                  {nativeCapabilities.systemAudioCapture
                    ? " Native mobile capture is available on supported Android setups."
                    : " Mobile browsers still do not reliably support full device audio output sharing."}
                </p>
              ) : null}
            </div>
          ) : null}

          {activeTab === "people" ? (
            <div className="app-panel">
              <div className="panel-heading">
                <h2>Participants</h2>
                <button
                  type="button"
                  className="button-secondary diagnostics-toggle"
                  onClick={() => setShowHostDetails((current) => !current)}
                >
                  {showHostDetails ? "Hide Details" : "View Details"}
                </button>
              </div>
              {showHostDetails ? (
                <div className="diagnostic-card">
                  <strong>Host details</strong>
                  <p className="diagnostic-line">{audioDebug}</p>
                  <p className="diagnostic-line">{hostSignalDebug}</p>
                </div>
              ) : null}
              <div className="listener-list">
                {participantList.length === 0 ? (
                  <p className="empty-state">No participants yet.</p>
                ) : (
                  participantList.map((user) => (
                    <div key={user.id} className="listener-pill participant-pill">
                      <span>{user.username}</span>
                      <strong>{user.role}</strong>
                    </div>
                  ))
                )}
              </div>
              <div className="activity-feed">
                <p className="section-kicker">Recent activity</p>
                {recentActivity.length === 0 ? (
                  <p className="empty-state">Join and leave updates will appear here.</p>
                ) : (
                  recentActivity.map((item, index) => (
                    <p key={`${item}-${index}`} className="activity-line">
                      {item}
                    </p>
                  ))
                )}
              </div>
            </div>
          ) : null}

          {activeTab === "chat" ? (
            <div className="app-panel">
              <div className="panel-heading">
                <h2>Room chat</h2>
                <span className="mini-caption">Quick coordination while the session stays live</span>
              </div>
              <div className="chat-feed chat-feed-large">
                {chatMessages.length === 0 ? (
                  <p className="empty-state">Room messages will appear here.</p>
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
                <input
                  className="text-input"
                  placeholder="Send a message to the room"
                  value={chatInput}
                  maxLength={220}
                  onChange={(event) => setChatInput(event.target.value)}
                />
                <button type="button" className="button-primary" onClick={handleSendChat}>
                  Send
                </button>
              </div>
            </div>
          ) : null}
        </article>

        <aside className="content-card workspace-side slide-up">
          <div className="panel-heading">
            <h2>Session access</h2>
            <span className="mini-caption">Share once, let everyone join fast</span>
          </div>
          {session ? (
            <div className="qr-stack qr-stack-center">
              <div className="qr-card">
                <QRCode value={joinUrl} size={180} />
              </div>
              <p className="info-line">
                <strong>Room ID:</strong> {session.roomId}
              </p>
              <p className="join-url">{joinUrl}</p>
              <div className="button-row compact-row">
                <button type="button" className="button-secondary" onClick={handleCopyJoinLink}>
                  Copy Link
                </button>
                {navigator.share ? (
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={handleShareJoinLink}
                  >
                    Share
                  </button>
                ) : null}
              </div>
              {copiedState ? <p className="subtle-text">{copiedState}</p> : null}
            </div>
          ) : (
            <p className="empty-state">
              Start a session to generate the room, QR code, and join link.
            </p>
          )}
        </aside>
      </section>
    </AppShell>
  );
}
