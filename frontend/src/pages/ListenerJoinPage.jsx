import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import jsQR from "jsqr";
import AppShell from "../components/AppShell";
import StatusBadge from "../components/StatusBadge";
import { fetchSession } from "../lib/api";
import { createAppId } from "../lib/ids";
import { normalizeRoomId, sanitizeDisplayName } from "../lib/sanitize";
import { getListenerSession, saveListenerSession } from "../lib/storage";
import { useCompactViewport } from "../lib/useCompactViewport";

export default function ListenerJoinPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const isCompactViewport = useCompactViewport();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const imageInputRef = useRef(null);
  const scannerStreamRef = useRef(null);
  const scannerFrameRef = useRef(null);
  const [room, setRoom] = useState(null);
  const [manualRoomId, setManualRoomId] = useState(roomId || "");
  const [status, setStatus] = useState("Checking room");
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState("");
  const [scannerSupported, setScannerSupported] = useState(false);
  const [savedListener, setSavedListener] = useState(null);
  const [activeJoinTab, setActiveJoinTab] = useState(roomId ? "room" : "manual");

  useEffect(() => {
    setScannerSupported(
      typeof window !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia)
    );
    const nextSavedListener = getListenerSession();
    setSavedListener(nextSavedListener);
    if (nextSavedListener?.roomId === roomId) {
      setUsername(nextSavedListener.username || "");
    }
  }, [roomId]);

  useEffect(() => {
    setActiveJoinTab(roomId ? "room" : "manual");
  }, [roomId]);

  useEffect(() => {
    if (activeJoinTab !== "scan" && isScanning) {
      stopScanner();
    }
  }, [activeJoinTab, isScanning]);

  useEffect(() => {
    if (!roomId) {
      setRoom(null);
      setStatus("Enter room ID");
      setError("");
      setIsJoining(false);
      return () => {};
    }

    let isMounted = true;
    setRoom(null);
    setError("");
    setStatus("Checking room");
    setIsJoining(false);

    fetchSession(roomId)
      .then((data) => {
        if (!isMounted) {
          return;
        }

        setRoom(data);
        setStatus("Room ready");
      })
      .catch((requestError) => {
        if (!isMounted) {
          return;
        }

        setError(requestError.message || "Invalid or expired room.");
        setStatus("Unavailable");
      });

    return () => {
      isMounted = false;
    };
  }, [roomId]);

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, []);

  function handleDetectedRoom(scannedValue) {
    const matchedRoom = scannedValue.match(/\/join\/([A-Z0-9-]+)/i);

    if (matchedRoom?.[1]) {
      const normalizedRoom = matchedRoom[1].toUpperCase();
      stopScanner();
      setManualRoomId(normalizedRoom);
      setIsJoining(true);
      navigate(`/join/${normalizedRoom}`);
      return true;
    }

    return false;
  }

  function stopScanner() {
    if (scannerFrameRef.current) {
      cancelAnimationFrame(scannerFrameRef.current);
      scannerFrameRef.current = null;
    }

    if (scannerStreamRef.current) {
      scannerStreamRef.current.getTracks().forEach((track) => track.stop());
      scannerStreamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsScanning(false);
  }

  async function handleStartScanner() {
    if (!scannerSupported) {
      setError("QR scanning is not supported on this browser. Enter the room ID manually.");
      return;
    }

    stopScanner();
    setError("");
    setScanStatus("Opening camera");

    try {
      const cameraOptions = [
        {
          video: {
            facingMode: {
              ideal: "environment"
            }
          },
          audio: false
        },
        {
          video: {
            facingMode: "environment"
          },
          audio: false
        },
        {
          video: true,
          audio: false
        }
      ];

      let stream = null;

      for (const mediaConstraints of cameraOptions) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
          break;
        } catch (_mediaError) {
          stream = null;
        }
      }

      if (!stream) {
        throw new Error("camera-unavailable");
      }

      scannerStreamRef.current = stream;
      setIsScanning(true);
      setScanStatus("Point the camera at the host QR code");

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const scanLoop = async () => {
        if (!videoRef.current || !canvasRef.current || videoRef.current.readyState < 2) {
          scannerFrameRef.current = requestAnimationFrame(scanLoop);
          return;
        }

        try {
          const canvas = canvasRef.current;
          const context = canvas.getContext("2d", { willReadFrequently: true });

          canvas.width = videoRef.current.videoWidth;
          canvas.height = videoRef.current.videoHeight;
          context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

          const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
          const result = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert"
          });

          if (result?.data) {
            if (handleDetectedRoom(result.data)) {
              return;
            }
            setScanStatus("QR found, but it is not a TOGETHER join link");
          }
        } catch (_scanError) {
          setScanStatus("Trying to detect the QR code");
        }

        scannerFrameRef.current = requestAnimationFrame(scanLoop);
      };

      scannerFrameRef.current = requestAnimationFrame(scanLoop);
    } catch (_error) {
      stopScanner();
      setError("Camera could not be opened on this phone. Use Room ID or Photo instead.");
    }
  }

  function handleCaptureFallback() {
    imageInputRef.current?.click();
  }

  async function handleQrImagePick(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setError("");
    setScanStatus("Reading QR image");

    try {
      const imageUrl = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => {
        try {
          const canvas = canvasRef.current;
          const context = canvas.getContext("2d", { willReadFrequently: true });

          canvas.width = image.naturalWidth || image.width;
          canvas.height = image.naturalHeight || image.height;
          context.drawImage(image, 0, 0, canvas.width, canvas.height);

          const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
          const result = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "attemptBoth"
          });

          URL.revokeObjectURL(imageUrl);

          if (result?.data && handleDetectedRoom(result.data)) {
            return;
          }

          setScanStatus("Could not read a TOGETHER QR from that image");
          setError("That photo did not contain a valid TOGETHER join QR. Try again or enter the room ID.");
        } catch (_decodeError) {
          setScanStatus("Could not read that image");
          setError("That image could not be scanned. Try a clearer photo or use manual room entry.");
        }
      };

      image.onerror = () => {
        URL.revokeObjectURL(imageUrl);
        setScanStatus("Could not open that image");
        setError("That image could not be opened. Try again.");
      };

      image.src = imageUrl;
    } catch (_error) {
      setScanStatus("Camera photo unavailable");
      setError("Could not open the phone camera/photo picker. Enter the room ID manually instead.");
    }
  }

  function handleJoin() {
    if (!roomId) {
      const nextRoomId = normalizeRoomId(manualRoomId);

      if (!nextRoomId) {
        setError("Enter a valid room ID or scan the QR code.");
        return;
      }

      setIsJoining(true);
      navigate(`/join/${nextRoomId}`);
      return;
    }

    try {
      setIsJoining(true);
      setStatus("Opening live session");
      const listenerId =
        savedListener?.roomId === roomId ? savedListener.listenerId : createAppId("listener");
      saveListenerSession({
        roomId,
        listenerId,
        username: sanitizeDisplayName(username || savedListener?.username, "Guest Listener"),
        hostId: room?.hostId || ""
      });

      navigate(`/listen/${roomId}`);
    } catch (_joinError) {
      setIsJoining(false);
      setStatus("Room ready");
      setError("Could not open the live session on this device. Please retry.");
    }
  }

  return (
    <AppShell>
      <section className={isCompactViewport ? "center-card workspace-card fade-in join-shell join-shell-mobile" : "center-card workspace-card fade-in join-shell"}>
        <div className="join-header">
          <div>
            <StatusBadge tone={error ? "danger" : "success"}>{status}</StatusBadge>
            <h1>Join TOGETHER Audio</h1>
          </div>
          <p className="subtle-text join-copy">
            Fast entry for live rooms, whether you scanned a QR, opened a shared link, or entered the room manually.
          </p>
        </div>
        {error ? <p className="error-banner">{error}</p> : null}

        {roomId ? (
          room ? (
            <>
              <div className="join-room-summary">
                <div className="workspace-stat">
                  <span>Room</span>
                  <strong>{roomId}</strong>
                </div>
                <div className="workspace-stat">
                  <span>Source</span>
                  <strong>
                    {room.audioSourceMode === "microphone"
                      ? "Microphone"
                      : room.audioSourceMode === "audio-file"
                        ? "Audio File"
                        : "Device Audio"}
                  </strong>
                </div>
                <div className="workspace-stat">
                  <span>Listeners online</span>
                  <strong>{room.users?.length || 0}</strong>
                </div>
              </div>
              <div className="join-room-card">
                <p className="hero-text compact">
                  You are entering room <strong>{roomId}</strong>. Add a name if you want other people in the room to recognize you.
                </p>
                <input
                  className="text-input"
                  placeholder="Your name (optional)"
                  value={username}
                  maxLength={32}
                  onChange={(event) => setUsername(sanitizeDisplayName(event.target.value, ""))}
                />
                <button
                  type="button"
                  className="button-primary large-button"
                  onClick={handleJoin}
                  disabled={isJoining}
                >
                  {isJoining ? "Opening..." : savedListener?.roomId === roomId ? "Resume Audio" : "Join Audio"}
                </button>
              </div>
            </>
          ) : (
            <div className="join-room-card">
              <p className="hero-text compact">
                We could not open that room right now. You can retry the same link or go back to manual join.
              </p>
              <div className="button-row">
                <button
                  type="button"
                  className="button-primary"
                  onClick={() => navigate(`/join/${roomId}`)}
                >
                  Retry room
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => navigate("/join")}
                >
                  Join another room
                </button>
              </div>
            </div>
          )
        ) : (
          <>
            <div className="app-tabs join-tabs" role="tablist" aria-label="Join methods">
              <button
                type="button"
                className={activeJoinTab === "manual" ? "app-tab active" : "app-tab"}
                onClick={() => setActiveJoinTab("manual")}
              >
                Room ID
              </button>
              <button
                type="button"
                className={activeJoinTab === "scan" ? "app-tab active" : "app-tab"}
                onClick={() => setActiveJoinTab("scan")}
              >
                Scan
              </button>
              <button
                type="button"
                className={activeJoinTab === "photo" ? "app-tab active" : "app-tab"}
                onClick={() => setActiveJoinTab("photo")}
              >
                Photo
              </button>
            </div>

            <div className="join-panel">
              {activeJoinTab === "manual" ? (
                <div className="join-mode-card">
                  <p className="hero-text compact">
                    Enter the room code exactly as shared by the host.
                  </p>
                  <input
                    className="text-input"
                    placeholder="Enter room ID"
                    value={manualRoomId}
                    maxLength={16}
                    onChange={(event) => setManualRoomId(normalizeRoomId(event.target.value))}
                  />
                  <button
                    type="button"
                    className="button-primary large-button"
                    onClick={handleJoin}
                    disabled={isJoining}
                  >
                    {isJoining ? "Opening..." : "Continue"}
                  </button>
                </div>
              ) : null}

              {activeJoinTab === "scan" ? (
                <div className="join-mode-card">
                  <p className="hero-text compact">
                    Open the camera directly and point it at the host QR code.
                  </p>
                  <button
                    type="button"
                    className="button-primary large-button"
                    onClick={handleStartScanner}
                    disabled={isJoining || isScanning}
                  >
                    {isScanning ? "Scanning QR..." : "Open Scanner"}
                  </button>
                  {!scannerSupported ? (
                    <p className="subtle-text">
                      Live scanning depends on browser camera support. You can still use a camera photo or room code.
                    </p>
                  ) : null}
                  {isScanning ? (
                    <div className="scanner-card">
                      <video ref={videoRef} className="scanner-video" playsInline muted />
                      <canvas ref={canvasRef} className="scanner-canvas" />
                      <p className="subtle-text">{scanStatus}</p>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={stopScanner}
                      >
                        Stop Scanner
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {activeJoinTab === "photo" ? (
                <div className="join-mode-card">
                  <p className="hero-text compact">
                    Use a screenshot or a quick camera photo of the host QR if live scanning is awkward on your device.
                  </p>
                  <button
                    type="button"
                    className="button-primary large-button"
                    onClick={handleCaptureFallback}
                    disabled={isJoining}
                  >
                    Use Camera Photo
                  </button>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="scanner-input"
                    onChange={handleQrImagePick}
                  />
                  <canvas ref={canvasRef} className="scanner-canvas" />
                  {scanStatus ? <p className="subtle-text">{scanStatus}</p> : null}
                </div>
              ) : null}

            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}
