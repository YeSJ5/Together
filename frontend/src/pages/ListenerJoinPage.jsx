import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import StatusBadge from "../components/StatusBadge";
import { fetchSession } from "../lib/api";
import { saveListenerSession } from "../lib/storage";

export default function ListenerJoinPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [room, setRoom] = useState(null);
  const [manualRoomId, setManualRoomId] = useState(roomId || "");
  const [status, setStatus] = useState("Checking room");
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");

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

      navigate(`/join/${nextRoomId}`);
      return;
    }

    const listenerId = `listener-${crypto.randomUUID()}`;
    saveListenerSession({
      roomId,
      listenerId,
      username: username.trim() || "Guest Listener",
      hostId: room?.hostId || ""
    });
    navigate(`/session/${roomId}`);
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
                >
                  Join Audio
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
                >
                  Continue
                </button>
              </>
            )}
          </>
        )}
      </section>
    </AppShell>
  );
}
