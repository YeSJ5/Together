import { API_BASE_URL } from "../config";
import { fetchWithTimeout } from "./api";

export const DEFAULT_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" }
];

let cachedIceServers = null;
let lastFetchTime = 0;
let currentCacheTtlMs = 30 * 60 * 1000; // default 30 minutes
let pendingIcePromise = null;

/**
 * Dynamically resolves ICE servers from backend.
 * Falls back to default STUN list if unreachable or timed out.
 */
export async function getDynamicIceServers() {
  const now = Date.now();
  if (cachedIceServers && now - lastFetchTime < currentCacheTtlMs) {
    return cachedIceServers;
  }

  if (pendingIcePromise) {
    return pendingIcePromise;
  }

  pendingIcePromise = (async () => {
    try {
      const response = await fetchWithTimeout(
        `${API_BASE_URL}/api/ice-servers?clientId=browser-${Math.random().toString(36).slice(2, 7)}`,
        { cache: "no-store" },
        4000
      );
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
          cachedIceServers = data.iceServers;
          lastFetchTime = Date.now();
          if (data.ttl && Number(data.ttl) > 0) {
            // Refresh at 80% of TTL or 30 minutes, minimum 30 seconds
            currentCacheTtlMs = Math.min(30 * 60 * 1000, Math.max(30000, Number(data.ttl) * 1000 * 0.8));
          }
          return cachedIceServers;
        }
      }
    } catch (_err) {
      // Graceful fallback to default STUN servers
    } finally {
      pendingIcePromise = null;
    }

    return DEFAULT_ICE_SERVERS;
  })();

  return pendingIcePromise;
}

export function createPeerConnection({
  onIceCandidate,
  onTrack,
  iceServers,
  iceTransportPolicy = "all",
  onConnectionStateChange,
  onSelectedCandidatePair
} = {}) {
  const configuration = {
    iceServers: iceServers || cachedIceServers || DEFAULT_ICE_SERVERS,
    iceTransportPolicy // 'all' for standard, 'relay' for restrictive network testing
  };

  const peerConnection = new RTCPeerConnection(configuration);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && onIceCandidate) {
      onIceCandidate(event.candidate);
    }
  };

  peerConnection.ontrack = (event) => {
    if (!onTrack) return;
    if (event.streams && event.streams[0]) {
      onTrack(event.streams[0]);
    } else if (event.track) {
      const stream = new MediaStream([event.track]);
      onTrack(stream);
    }
  };

  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    if (onConnectionStateChange) {
      onConnectionStateChange(state);
    }

    if (state === "connected" && onSelectedCandidatePair) {
      inspectCandidatePair(peerConnection)
        .then((pair) => onSelectedCandidatePair(pair))
        .catch(() => {});
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    if (peerConnection.iceConnectionState === "connected" && onSelectedCandidatePair) {
      inspectCandidatePair(peerConnection)
        .then((pair) => onSelectedCandidatePair(pair))
        .catch(() => {});
    }
  };

  return peerConnection;
}

/**
 * Inspects RTCPeerConnection stats to extract active ICE candidate pair and type (host, srflx, relay).
 */
export async function inspectCandidatePair(peerConnection) {
  if (!peerConnection || typeof peerConnection.getStats !== "function") {
    return null;
  }

  try {
    const stats = await peerConnection.getStats();
    let selectedPair = null;

    stats.forEach((report) => {
      if (report.type === "transport" && report.selectedCandidatePairId) {
        selectedPair = stats.get(report.selectedCandidatePairId);
      }
    });

    if (!selectedPair) {
      stats.forEach((report) => {
        if (report.type === "candidate-pair" && (report.selected || report.nominated || report.state === "succeeded")) {
          selectedPair = report;
        }
      });
    }

    if (selectedPair) {
      const localCandidate = stats.get(selectedPair.localCandidateId);
      const remoteCandidate = stats.get(selectedPair.remoteCandidateId);

      return {
        state: selectedPair.state,
        localCandidateType: localCandidate?.candidateType || "unknown",
        localProtocol: localCandidate?.protocol || "unknown",
        remoteCandidateType: remoteCandidate?.candidateType || "unknown",
        remoteProtocol: remoteCandidate?.protocol || "unknown",
        isRelayed: localCandidate?.candidateType === "relay" || remoteCandidate?.candidateType === "relay"
      };
    }
  } catch (_e) {}

  return null;
}

export async function captureHostAudio(audioSourceMode) {
  // If microphone / device speaker mode: use pure uncompressed audio without aggressive voice suppression
  if (audioSourceMode === "microphone") {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
        sampleRate: { ideal: 48000 }
      },
      video: false
    });
  }

  // Device / System Audio (Apps, Tabs, Screen)
  if (navigator.mediaDevices?.getDisplayMedia) {
    try {
      let displayStream;
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            displaySurface: "browser"
          },
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            suppressLocalAudioPlayback: false
          },
          systemAudio: "include",
          surfaceSwitching: "include",
          selfBrowserSurface: "exclude"
        });
      } catch (advancedErr) {
        if (advancedErr.name === "TypeError" || advancedErr.name === "OverconstrainedError") {
          displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false
            }
          });
        } else {
          throw advancedErr;
        }
      }

      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length > 0) {
        // Stop video immediately to save battery, memory, and bandwidth
        displayStream.getVideoTracks().forEach((track) => track.stop());
        return new MediaStream(audioTracks);
      }
    } catch (_err) {
      // User cancelled or browser rejected getDisplayMedia; fallback below
    }
  }

  // Fallback: Pure stereo audio capture
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
      sampleRate: { ideal: 48000 }
    },
    video: false
  });
}
