const rtcConfig = {
  iceServers: [
    {
      urls: ["stun:stun.l.google.com:19302"]
    }
  ]
};

export function createPeerConnection({ onIceCandidate, onTrack }) {
  const peerConnection = new RTCPeerConnection(rtcConfig);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      onIceCandidate(event.candidate);
    }
  };

  peerConnection.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      onTrack(event.streams[0]);
    }
  };

  return peerConnection;
}

export async function captureHostAudio(audioSourceMode) {
  if (audioSourceMode === "microphone") {
    return navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false
    });
  }

  return navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  });
}
