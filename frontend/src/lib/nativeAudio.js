import { Capacitor, registerPlugin } from "@capacitor/core";

const TogetherAudio = registerPlugin("TogetherAudio");

function decodePcmChunk(base64Chunk, channelCount) {
  const binary = atob(base64Chunk);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const bytesPerFrame = 2 * channelCount;
  const frameCount = Math.floor(bytes.byteLength / bytesPerFrame);
  const channelData = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
  const view = new DataView(bytes.buffer);

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sampleOffset = (frame * channelCount + channel) * 2;
      const sample = view.getInt16(sampleOffset, true);
      channelData[channel][frame] = sample / 32768;
    }
  }

  return {
    frameCount,
    channelData
  };
}

export function isNativeAndroidApp() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export async function getNativeAudioCapabilities() {
  if (!isNativeAndroidApp()) {
    return {
      nativeAndroid: false,
      systemAudioCapture: false,
      backgroundPlaybackService: false
    };
  }

  return TogetherAudio.getCapabilities();
}

export async function enableNativeBackgroundPlayback() {
  if (!isNativeAndroidApp()) {
    return;
  }

  await TogetherAudio.enableBackgroundPlayback();
}

export async function disableNativeBackgroundPlayback() {
  if (!isNativeAndroidApp()) {
    return;
  }

  await TogetherAudio.disableBackgroundPlayback();
}

export async function startNativeSystemAudioBridge() {
  if (!isNativeAndroidApp()) {
    throw new Error("Native Android audio capture is not available here.");
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("AudioContext is not available on this device.");
  }

  const audioContext = new AudioContextClass();
  await audioContext.resume();

  const outputGain = audioContext.createGain();
  const destination = audioContext.createMediaStreamDestination();
  outputGain.connect(destination);
  outputGain.connect(audioContext.destination);

  let scheduledTime = audioContext.currentTime + 0.15;

  const pcmSubscription = await TogetherAudio.addListener("pcmChunk", (event) => {
    const channelCount = Number(event.channels) || 2;
    const sampleRate = Number(event.sampleRate) || 44100;
    const decoded = decodePcmChunk(event.chunkBase64, channelCount);

    if (!decoded.frameCount) {
      return;
    }

    const buffer = audioContext.createBuffer(channelCount, decoded.frameCount, sampleRate);
    decoded.channelData.forEach((channelData, channelIndex) => {
      buffer.copyToChannel(channelData, channelIndex);
    });

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(outputGain);

    const now = audioContext.currentTime;
    if (scheduledTime < now + 0.05) {
      scheduledTime = now + 0.05;
    }

    if (scheduledTime > now + 1.5) {
      scheduledTime = now + 0.12;
    }

    source.start(scheduledTime);
    scheduledTime += buffer.duration;
  });

  const stopSubscription = await TogetherAudio.addListener("captureStopped", () => {
    scheduledTime = audioContext.currentTime + 0.1;
  });

  await TogetherAudio.startSystemAudioCapture();

  return {
    stream: destination.stream,
    async stop() {
      await TogetherAudio.stopSystemAudioCapture().catch(() => {});
      await pcmSubscription.remove();
      await stopSubscription.remove();
      await audioContext.close().catch(() => {});
    }
  };
}
