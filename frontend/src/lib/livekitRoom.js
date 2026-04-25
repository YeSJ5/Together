import { Room, RoomEvent, Track } from "livekit-client";
import { requestLiveKitAccess } from "./realtime";

function createRoomClient() {
  return new Room({
    adaptiveStream: true,
    dynacast: true
  });
}

function getAudioTrackFromStream(mediaStream) {
  return mediaStream?.getAudioTracks?.()[0] || null;
}

export function isLiveKitSession(session) {
  return session?.mediaBackend === "livekit";
}

export async function connectHostToLiveKitRoom({
  roomId,
  participantId,
  participantName,
  mediaStream,
  onStatusChange
}) {
  const publishTrack = getAudioTrackFromStream(mediaStream);

  if (!publishTrack) {
    throw new Error("No host audio track is available for LiveKit publishing.");
  }

  onStatusChange?.("Requesting LiveKit host access");
  const access = await requestLiveKitAccess({
    roomId,
    participantId,
    participantName,
    role: "host",
    canPublish: true,
    canSubscribe: false
  });

  const room = createRoomClient();
  room
    .on(RoomEvent.Reconnecting, () => {
      onStatusChange?.("Reconnecting host transport");
    })
    .on(RoomEvent.Reconnected, () => {
      onStatusChange?.("Host transport restored");
    })
    .on(RoomEvent.Disconnected, () => {
      onStatusChange?.("Host transport disconnected");
    });

  onStatusChange?.("Connecting host transport");
  await room.connect(access.url, access.token, {
    autoSubscribe: false
  });

  onStatusChange?.("Publishing host audio");
  let publication = await room.localParticipant.publishTrack(publishTrack, {
    name: "together-live-audio"
  });

  onStatusChange?.("LiveKit host transport active");

  return {
    room,
    async replaceAudioTrack(nextMediaStream) {
      const nextTrack = getAudioTrackFromStream(nextMediaStream);

      if (!nextTrack) {
        throw new Error("No replacement audio track is available for LiveKit publishing.");
      }

      if (publication?.track) {
        await room.localParticipant.unpublishTrack(publication.track, false);
      }

      publication = await room.localParticipant.publishTrack(nextTrack, {
        name: "together-live-audio"
      });
      onStatusChange?.("LiveKit host source switched");
    },
    async disconnect() {
      room.disconnect();
    }
  };
}

export async function connectListenerToLiveKitRoom({
  roomId,
  participantId,
  participantName,
  audioElement,
  onStatusChange,
  onAudioTrack,
  onPlaybackStarted,
  onPlaybackBlocked
}) {
  const access = await requestLiveKitAccess({
    roomId,
    participantId,
    participantName,
    role: "listener",
    canPublish: false,
    canSubscribe: true
  });

  const room = createRoomClient();

  const attachTrack = async (track) => {
    if (track.kind !== Track.Kind.Audio || !audioElement) {
      return;
    }

    const mediaStreamTrack = track.mediaStreamTrack;

    if (!mediaStreamTrack) {
      return;
    }

    audioElement.srcObject = new MediaStream([mediaStreamTrack]);
    onAudioTrack?.();

    try {
      await audioElement.play();
      onPlaybackStarted?.();
      onStatusChange?.("LiveKit listener connected");
    } catch (_error) {
      onPlaybackBlocked?.();
    }
  };

  room
    .on(RoomEvent.TrackSubscribed, (track) => {
      attachTrack(track).catch(() => {});
    })
    .on(RoomEvent.TrackUnsubscribed, (track) => {
      if (
        track.kind === Track.Kind.Audio &&
        audioElement?.srcObject instanceof MediaStream
      ) {
        audioElement.srcObject = null;
      }
    })
    .on(RoomEvent.Reconnecting, () => {
      onStatusChange?.("Reconnecting listener transport");
    })
    .on(RoomEvent.Reconnected, () => {
      onStatusChange?.("Listener transport restored");
    })
    .on(RoomEvent.Disconnected, () => {
      onStatusChange?.("Listener transport disconnected");
    });

  onStatusChange?.("Connecting listener transport");
  await room.connect(access.url, access.token, {
    autoSubscribe: true
  });

  room.remoteParticipants.forEach((participant) => {
    participant.trackPublications.forEach((publication) => {
      if (publication.isSubscribed && publication.track) {
        attachTrack(publication.track).catch(() => {});
      }
    });
  });

  return {
    room,
    async disconnect() {
      room.disconnect();
    }
  };
}
