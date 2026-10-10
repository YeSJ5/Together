const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" }
  ]
};

export function createPeerConnection({ onIceCandidate, onTrack }) {
  const peerConnection = new RTCPeerConnection(rtcConfig);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && onIceCandidate) {
      onIceCandidate(event.candidate);
    }
  };

  peerConnection.ontrack = (event) => {
    if (event.streams && event.streams[0] && onTrack) {
      onTrack(event.streams[0]);
    }
  };

  return peerConnection;
}

export async function captureHostAudio(audioSourceMode) {
  // If microphone / device speaker mode: use pure uncompressed audio without noise cancellation
  // (Noise cancellation actively suppresses and erases music from YouTube, Spotify, and instruments)
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
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

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

  // Fallback: Pure stereo audio capture without music filters
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

