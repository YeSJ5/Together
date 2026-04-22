import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import jsQR from "jsqr";
import AppShell from "../components/AppShell";
import StatusBadge from "../components/StatusBadge";
import { fetchSession } from "../lib/api";
import { createAppId } from "../lib/ids";
import { getListenerSession, saveListenerSession } from "../lib/storage";

export default function ListenerJoinPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
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
    if (!roomId) {
      setRoom(null);
      setStatus("Enter room ID");
      setError("");
      return () => {};
    }

    let isMounted = true;

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

    setError("");
    setScanStatus("Opening camera");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: {
            ideal: "environment"
          }
        },
        audio: false
      });

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
            const matchedRoom = result.data.match(/\/join\/([A-Z0-9-]+)/i);

            if (matchedRoom?.[1]) {
              const normalizedRoom = matchedRoom[1].toUpperCase();
              stopScanner();
              setManualRoomId(normalizedRoom);
              setIsJoining(true);
              window.location.assign(`${window.location.origin}/join/${normalizedRoom}`);
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
      setError("Camera access was denied. Enter the room ID manually instead.");
    }
  }

  function handleJoin() {
    if (!roomId) {
      const nextRoomId = manualRoomId.trim().toUpperCase();

      if (!nextRoomId) {
        setError("Enter a valid room ID or scan the QR code.");
        return;
      }

      setIsJoining(true);
      window.location.assign(`${window.location.origin}/join/${nextRoomId}`);
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
        username: username.trim() || savedListener?.username || "Guest Listener",
        hostId: room?.hostId || ""
      });

      window.location.assign(`${window.location.origin}/session/${roomId}`);
    } catch (_joinError) {
      setIsJoining(false);
      setStatus("Room ready");
      setError("Could not open the live session on this device. Please retry.");
    }
  }

  return (
    <AppShell>
      <section className="center-card fade-in">
        <StatusBadge tone={error ? "danger" : "success"}>{status}</StatusBadge>
        <h1>Join TOGETHER Audio</h1>
        {error ? (
          <p className="error-banner">{error}</p>
        ) : (
          <>
            {roomId ? (
              <>
                <p className="hero-text compact">
                  You are joining room <strong>{roomId}</strong>. Tap the button below
                  to connect to the live stream.
                </p>
                <div className="room-meta">
                  <span>
                    Source:{" "}
                    {room?.audioSourceMode === "microphone"
                      ? "Microphone"
                      : room?.audioSourceMode === "audio-file"
                        ? "Audio File"
                        : "Device Audio"}
                  </span>
                  <span>Listeners online: {room?.users?.length || 0}</span>
                </div>
                <input
                  className="text-input"
                  placeholder="Your name (optional)"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
                <button
                  type="button"
                  className="button-primary large-button"
                  onClick={handleJoin}
                  disabled={isJoining}
                >
                  {isJoining ? "Opening..." : savedListener?.roomId === roomId ? "Resume Audio" : "Join Audio"}
                </button>
              </>
            ) : (
              <>
                <p className="hero-text compact">
                  Scan the host QR code or enter the room ID manually to continue.
                </p>
                <div className="join-actions-stack">
                  <button
                    type="button"
                    className="button-secondary large-button"
                    onClick={handleStartScanner}
                    disabled={isJoining || isScanning}
                  >
                    {isScanning ? "Scanning QR..." : "Scan QR Code"}
                  </button>
                  {!scannerSupported ? (
                    <p className="subtle-text">
                      QR scanning depends on browser camera support. Manual room entry is always available.
                    </p>
                  ) : null}
                </div>
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
                <input
                  className="text-input"
                  placeholder="Enter room ID"
                  value={manualRoomId}
                  onChange={(event) => setManualRoomId(event.target.value)}
                />
                <button
                  type="button"
                  className="button-primary large-button"
                  onClick={handleJoin}
                  disabled={isJoining}
                >
                  {isJoining ? "Opening..." : "Continue"}
                </button>
              </>
            )}
          </>
        )}
      </section>
    </AppShell>
  );
}
