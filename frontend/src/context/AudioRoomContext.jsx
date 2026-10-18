import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { leaveSessionInBackground } from "../lib/api";

const AudioRoomContext = createContext(null);

export function AudioRoomProvider({ children }) {
  const [activeRoomId, setActiveRoomId] = useState(null);
  const [role, setRole] = useState(null); // "host" | "listener" | null
  const [roomTitle, setRoomTitle] = useState("");
  const [hostName, setHostName] = useState("");
  const [category, setCategory] = useState("Music");
  const [isConnected, setIsConnected] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [audioLevel, setAudioLevel] = useState(0);
  const [listenerCount, setListenerCount] = useState(1);
  const [participants, setParticipants] = useState([]);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [transcripts, setTranscripts] = useState([]);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);

  // Persistent audio element across all route transitions
  const persistentAudioRef = useRef(null);
  const socketRef = useRef(null);
  const cleanupFnRef = useRef(null);

  // Initialize singleton audio element
  useEffect(() => {
    if (typeof window !== "undefined" && !persistentAudioRef.current) {
      const audio = new Audio();
      audio.autoplay = true;
      audio.playsInline = true;
      audio.setAttribute("playsinline", "true");
      audio.setAttribute("webkit-playsinline", "true");
      persistentAudioRef.current = audio;
    }
  }, []);

  const setVolume = useCallback((val) => {
    const clamped = Math.max(0, Math.min(1, val));
    setVolumeState(clamped);
    if (persistentAudioRef.current) {
      persistentAudioRef.current.volume = isMuted ? 0 : clamped;
    }
  }, [isMuted]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (persistentAudioRef.current) {
        persistentAudioRef.current.volume = next ? 0 : volume;
      }
      return next;
    });
  }, [volume]);

  const togglePlayback = useCallback(() => {
    if (!persistentAudioRef.current) return;
    if (isPlaying) {
      persistentAudioRef.current.pause();
      setIsPlaying(false);
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "paused";
      }
    } else {
      persistentAudioRef.current.play().then(() => {
        setIsPlaying(true);
        if ("mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "playing";
        }
      }).catch(() => {});
    }
  }, [isPlaying]);

  const attachStreamToAudio = useCallback((stream) => {
    if (!persistentAudioRef.current) {
      if (typeof window !== "undefined") {
        const audio = new Audio();
        audio.autoplay = true;
        audio.playsInline = true;
        audio.setAttribute("playsinline", "true");
        audio.setAttribute("webkit-playsinline", "true");
        persistentAudioRef.current = audio;
      } else {
        return Promise.resolve(false);
      }
    }
    const audio = persistentAudioRef.current;
    audio.playsInline = true;
    audio.setAttribute("playsinline", "true");
    audio.setAttribute("webkit-playsinline", "true");
    audio.srcObject = stream;
    audio.volume = isMuted ? 0 : volume;
    return audio.play().then(() => {
      setIsPlaying(true);
      return true;
    }).catch((err) => {
      setIsPlaying(false);
      throw err;
    });
  }, [isMuted, volume]);

  const triggerReaction = useCallback((reaction) => {
    setReactions((prev) => [
      ...prev.slice(-15),
      {
        id: reaction.id || `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        emoji: reaction.emoji,
        senderName: reaction.senderName || "Friend",
        createdAt: Date.now()
      }
    ]);
  }, []);

  const addTranscriptChunk = useCallback((chunk) => {
    setTranscripts((prev) => {
      const updated = [...prev];
      if (!chunk.isFinal && updated.length > 0 && !updated[updated.length - 1].isFinal) {
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          text: chunk.text,
          timestamp: Date.now()
        };
        return updated;
      }
      return [
        ...updated.slice(-30),
        {
          id: chunk.id || `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          text: chunk.text,
          isFinal: Boolean(chunk.isFinal),
          senderName: chunk.senderName || "Speaker",
          timestamp: Date.now()
        }
      ];
    });
  }, []);

  const registerActiveSession = useCallback(({
    roomId,
    userRole,
    title,
    host,
    cat,
    socket,
    cleanup
  }) => {
    setActiveRoomId(roomId);
    setRole(userRole);
    setRoomTitle(title || `${host}'s Room`);
    setHostName(host);
    setCategory(cat || "Music");
    setIsConnected(true);
    socketRef.current = socket;
    cleanupFnRef.current = cleanup;
  }, []);

  const leaveActiveSession = useCallback(() => {
    if (cleanupFnRef.current) {
      try {
        cleanupFnRef.current();
      } catch (_e) {}
      cleanupFnRef.current = null;
    }

    if (persistentAudioRef.current) {
      persistentAudioRef.current.pause();
      persistentAudioRef.current.srcObject = null;
    }

    if (activeRoomId && role === "listener") {
      leaveSessionInBackground(activeRoomId, { listenerId: "active-listener" });
    }

    setActiveRoomId(null);
    setRole(null);
    setRoomTitle("");
    setHostName("");
    setIsConnected(false);
    setIsPlaying(false);
    setAudioLevel(0);
    setCurrentTrack(null);
    setParticipants([]);
    setChatMessages([]);
    setReactions([]);
    setTranscripts([]);
    socketRef.current = null;
  }, [activeRoomId, role]);

  const value = {
    activeRoomId,
    role,
    roomTitle,
    setRoomTitle,
    hostName,
    setHostName,
    category,
    setCategory,
    isConnected,
    setIsConnected,
    isPlaying,
    setIsPlaying,
    isMuted,
    toggleMute,
    volume,
    setVolume,
    togglePlayback,
    audioLevel,
    setAudioLevel,
    listenerCount,
    setListenerCount,
    participants,
    setParticipants,
    currentTrack,
    setCurrentTrack,
    chatMessages,
    setChatMessages,
    reactions,
    triggerReaction,
    transcripts,
    addTranscriptChunk,
    captionsEnabled,
    setCaptionsEnabled,
    persistentAudioRef,
    attachStreamToAudio,
    registerActiveSession,
    leaveActiveSession,
    socket: socketRef.current
  };

  return (
    <AudioRoomContext.Provider value={value}>
      {children}
    </AudioRoomContext.Provider>
  );
}

export function useAudioRoom() {
  const context = useContext(AudioRoomContext);
  if (!context) {
    throw new Error("useAudioRoom must be used within an AudioRoomProvider");
  }
  return context;
}
