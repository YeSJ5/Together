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
  if (audioSourceMode === "microphone") {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
  }

  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Device audio capture is not supported on this browser. Try Google Chrome or Microsoft Edge.");
  }

  const displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  });

  const audioTracks = displayStream.getAudioTracks();

  if (audioTracks.length === 0) {
    displayStream.getTracks().forEach((track) => track.stop());
    throw new Error(
      "No audio was shared. Make sure to check the 'Share audio' / 'Also share tab audio' checkbox in the browser popup."
    );
  }

  // Stop video tracks immediately to prevent unnecessary CPU and network usage
  displayStream.getVideoTracks().forEach((track) => track.stop());

  return new MediaStream(audioTracks);
}

