import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import jsQR from "jsqr";
import AppShell from "../components/AppShell";
import { fetchSession } from "../lib/api";
import { normalizeRoomId, sanitizeDisplayName } from "../lib/sanitize";
import { getListenerSession, saveListenerSession } from "../lib/storage";

export default function ListenerJoinPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("code");
  const [manualCode, setManualCode] = useState(roomId ? roomId.replace("ROOM-", "") : "");
  const [username, setUsername] = useState(() => {
    const saved = getListenerSession();
    return saved?.username || "";
  });
  const [roomData, setRoomData] = useState(null);
  const [isLoading, setIsLoading] = useState(Boolean(roomId));
  const [error, setError] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [cameraError, setCameraError] = useState("");

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const scannerStreamRef = useRef(null);
  const animationFrameRef = useRef(null);

  // Validate room if roomId exists in URL
  useEffect(() => {
    if (!roomId) {
      setRoomData(null);
      setIsLoading(false);
      return;
    }

    const normalized = normalizeRoomId(roomId);
    setIsLoading(true);
    setError("");

    fetchSession(normalized)
      .then((data) => {
        setRoomData(data);
      })
      .catch((err) => {
        setError(err.message || "Room not found or session has ended.");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [roomId]);

  // Clean up scanner when tab changes or unmounts
  useEffect(() => {
    if (activeTab !== "scan") {
      stopScanner();
    } else if (!roomId) {
      startScanner();
    }
    return () => {
      stopScanner();
    };
  }, [activeTab, roomId]);

  function stopScanner() {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (scannerStreamRef.current) {
      scannerStreamRef.current.getTracks().forEach((t) => t.stop());
      scannerStreamRef.current = null;
    }
    setIsScanning(false);
  }

  async function startScanner() {
    stopScanner();
    setCameraError("");

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera is not supported on this browser. Please enter the room code manually.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });

      scannerStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute("playsinline", "true");
        await videoRef.current.play();
        setIsScanning(true);
        scanFrame();
      }
    } catch (_err) {
      setCameraError("Unable to access camera. Please allow camera permissions or enter the code manually.");
    }
  }

  function scanFrame() {
    if (!videoRef.current || videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) {
      animationFrameRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    const video = videoRef.current;
    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    if (!ctx) {
      animationFrameRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "dontInvert"
    });

    if (code?.data) {
      const match = code.data.match(/\/join\/([A-Za-z0-9-]+)/i);
      if (match?.[1]) {
        const foundRoom = normalizeRoomId(match[1]);
        stopScanner();
        navigate(`/join/${foundRoom}`);
        return;
      }
      if (/^[A-Za-z0-9-]{4,12}$/.test(code.data.trim())) {
        const foundRoom = normalizeRoomId(code.data.trim());
        stopScanner();
        navigate(`/join/${foundRoom}`);
        return;
      }
    }

    animationFrameRef.current = requestAnimationFrame(scanFrame);
  }

  function handleJoinRoom() {
    const finalRoomId = normalizeRoomId(roomId || manualCode);
    if (!finalRoomId) {
      setError("Please specify a valid room code.");
      return;
    }

    const finalName = sanitizeDisplayName(username, "Listener");
    saveListenerSession({
      roomId: finalRoomId,
      username: finalName
    });

    navigate(`/listen/${finalRoomId}`);
  }

  function handleCodeSubmit(e) {
    e.preventDefault();
    const normalized = normalizeRoomId(manualCode);
    if (!normalized) {
      setError("Enter a room code.");
      return;
    }
    navigate(`/join/${normalized}`);
  }

  return (
    <AppShell>
      <div style={{ maxWidth: "520px", margin: "40px auto 0" }}>
        {roomId ? (
          /* ROOM FOUND / CONFIRMATION CARD */
          <div className="content-card fade-in" style={{ padding: "32px" }}>
            <div style={{ textAlign: "center", marginBottom: "24px" }}>
              <span style={{ fontSize: "2.5rem", display: "block", marginBottom: "8px" }}>🎧</span>
              <h1 style={{ fontSize: "1.75rem", margin: "0 0 6px" }}>Join Audio Session</h1>
              <span className="room-code-badge" style={{
                display: "inline-block",
                padding: "6px 18px",
                background: "rgba(16, 185, 129, 0.15)",
                color: "var(--accent-primary)",
                border: "1px solid rgba(16, 185, 129, 0.4)",
                borderRadius: "999px",
                fontWeight: 700,
                letterSpacing: "0.1em"
              }}>
                {normalizeRoomId(roomId)}
              </span>
            </div>

            {isLoading ? (
              <p style={{ textAlign: "center", color: "var(--text-secondary)" }}>Connecting to station...</p>
            ) : error ? (
              <div style={{ textAlign: "center" }}>
                <p style={{ color: "var(--accent-rose)", marginBottom: "16px" }}>{error}</p>
                <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
                  <button
                    type="button"
                    className="button-primary"
                    onClick={() => {
                      const normalized = normalizeRoomId(roomId);
                      setIsLoading(true);
                      setError("");
                      fetchSession(normalized)
                        .then((data) => setRoomData(data))
                        .catch((err) => setError(err.message || "Room not found or session has ended."))
                        .finally(() => setIsLoading(false));
                    }}
                    style={{ padding: "8px 18px", fontSize: "0.85rem" }}
                  >
                    🔄 Retry Connection
                  </button>
                  <Link to="/join" className="button-secondary" style={{ display: "inline-block", textDecoration: "none" }}>
                    &larr; Try Another Station
                  </Link>
                </div>
              </div>
            ) : (
              <div>
                <div style={{
                  background: "rgba(0, 0, 0, 0.25)",
                  border: "1px solid var(--border-subtle)",
                  padding: "16px 20px",
                  borderRadius: "14px",
                  marginBottom: "20px",
                  fontSize: "0.92rem",
                  display: "flex",
                  justifyContent: "space-between"
                }}>
                  <div>
                    <span style={{ color: "var(--text-secondary)", display: "block", fontSize: "0.8rem" }}>Host</span>
                    <strong>{roomData?.hostName || "Host"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-secondary)", display: "block", fontSize: "0.8rem" }}>Category</span>
                    <strong style={{ color: "var(--accent-cyan)" }}>
                      {roomData?.category || "Music"}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-secondary)", display: "block", fontSize: "0.8rem" }}>Listeners</span>
                    <strong>{(roomData?.users?.length || 0) + 1}</strong>
                  </div>
                </div>

                {roomData?.title && (
                  <p style={{ margin: "-10px 0 16px", fontSize: "0.92rem", fontWeight: 700, color: "var(--text-main)", textAlign: "center" }}>
                    "{roomData.title}"
                  </p>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <label className="field-block">
                    <span className="field-label">Your Display Name</span>
                    <input
                      type="text"
                      placeholder="Listener"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      maxLength={30}
                      className="text-input"
                    />
                  </label>

                  <button
                    type="button"
                    className="button-primary"
                    onClick={handleJoinRoom}
                    style={{ width: "100%", justifyContent: "center", padding: "14px", fontSize: "1.05rem" }}
                  >
                    Tune In & Listen &rarr;
                  </button>

                  <Link to="/join" className="subtle-text" style={{ textAlign: "center", textDecoration: "none", fontSize: "0.85rem" }}>
                    Switch to a different room
                  </Link>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* NO ROOM ID: TABS FOR SCAN OR CODE */
          <div className="content-card fade-in" style={{ padding: "32px" }}>
            <h1 style={{ fontSize: "1.6rem", textAlign: "center", margin: "0 0 20px" }}>Join a Session</h1>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "24px" }}>
              <button
                type="button"
                className={`button-secondary ${activeTab === "scan" ? "active-pill" : ""}`}
                onClick={() => setActiveTab("scan")}
                style={{
                  fontWeight: activeTab === "scan" ? 700 : 500,
                  borderColor: activeTab === "scan" ? "#ff8c42" : "inherit"
                }}
              >
                📷 Scan QR Code
              </button>
              <button
                type="button"
                className={`button-secondary ${activeTab === "code" ? "active-pill" : ""}`}
                onClick={() => setActiveTab("code")}
                style={{
                  fontWeight: activeTab === "code" ? 700 : 500,
                  borderColor: activeTab === "code" ? "#ff8c42" : "inherit"
                }}
              >
                ⌨️ Enter Room Code
              </button>
            </div>

            {activeTab === "scan" ? (
              <div style={{ textAlign: "center" }}>
                {cameraError ? (
                  <div>
                    <p style={{ color: "#d9383a", fontSize: "0.9rem" }}>{cameraError}</p>
                    <button type="button" className="button-secondary" onClick={startScanner} style={{ marginTop: "8px" }}>
                      Retry Camera
                    </button>
                  </div>
                ) : (
                  <div>
                    <div style={{
                      position: "relative",
                      width: "100%",
                      aspectRatio: "1/1",
                      maxHeight: "320px",
                      background: "#000",
                      borderRadius: "16px",
                      overflow: "hidden",
                      margin: "0 auto 16px"
                    }}>
                      <video
                        ref={videoRef}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                      <div style={{
                        position: "absolute",
                        top: "20%",
                        left: "20%",
                        right: "20%",
                        bottom: "20%",
                        border: "2px solid rgba(255, 140, 66, 0.9)",
                        borderRadius: "12px",
                        boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.4)",
                        pointerEvents: "none"
                      }} />
                    </div>
                    <p className="subtle-text" style={{ fontSize: "0.88rem", margin: 0 }}>
                      Point camera at the host's QR code to join automatically.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={handleCodeSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <label className="field-block">
                  <span className="field-label">Room Code</span>
                  <input
                    type="text"
                    placeholder="e.g. AX27"
                    value={manualCode}
                    onChange={(e) => {
                      setManualCode(e.target.value.toUpperCase());
                      setError("");
                    }}
                    maxLength={12}
                    className="text-input"
                    style={{ textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, fontSize: "1.1rem" }}
                  />
                </label>

                {error && <p style={{ color: "#d9383a", fontSize: "0.85rem", margin: 0 }}>{error}</p>}

                <button type="submit" className="button-primary" style={{ width: "100%", justifyContent: "center" }}>
                  Find Room &rarr;
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
