import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import StatusBadge from "../components/StatusBadge";
import { fetchSession } from "../lib/api";
import { createAppId } from "../lib/ids";
import { saveListenerSession } from "../lib/storage";

export default function ListenerJoinPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [room, setRoom] = useState(null);
  const [manualRoomId, setManualRoomId] = useState(roomId || "");
  const [status, setStatus] = useState("Checking room");
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [isJoining, setIsJoining] = useState(false);

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
      const listenerId = createAppId("listener");
      saveListenerSession({
        roomId,
        listenerId,
        username: username.trim() || "Guest Listener",
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
                  {isJoining ? "Opening..." : "Join Audio"}
                </button>
              </>
            ) : (
              <>
                <p className="hero-text compact">
                  Scan the host QR code or enter the room ID manually to continue.
                </p>
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
