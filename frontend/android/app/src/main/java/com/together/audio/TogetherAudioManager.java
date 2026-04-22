package com.together.audio;

import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;

import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class TogetherAudioManager {
    public interface CaptureListener {
        void onPcmChunk(byte[] data, int sampleRate, int channels);
        void onCaptureStopped(String reason);
    }

    private static TogetherAudioManager instance;

    private final Context appContext;
    private CaptureListener captureListener;
    private MediaProjection mediaProjection;
    private AudioRecord audioRecord;
    private ExecutorService captureExecutor;
    private volatile boolean capturing;
    private int sampleRate = 44100;
    private int channelCount = 2;

    private TogetherAudioManager(Context context) {
        this.appContext = context.getApplicationContext();
    }

    public static synchronized TogetherAudioManager getInstance(Context context) {
        if (instance == null) {
            instance = new TogetherAudioManager(context);
        }

        return instance;
    }

    public boolean supportsSystemAudioCapture() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
    }

    public boolean isCapturing() {
        return capturing;
    }

    public int getSampleRate() {
        return sampleRate;
    }

    public int getChannelCount() {
        return channelCount;
    }

    public synchronized void setCaptureListener(CaptureListener listener) {
        this.captureListener = listener;
    }

    public synchronized void startCapture(int resultCode, Intent data) throws Exception {
        if (!supportsSystemAudioCapture()) {
            throw new IllegalStateException("System audio capture requires Android 10 or newer.");
        }

        stopCapture();

        MediaProjectionManager projectionManager =
            (MediaProjectionManager) appContext.getSystemService(Context.MEDIA_PROJECTION_SERVICE);

        if (projectionManager == null) {
            throw new IllegalStateException("MediaProjection is not available on this device.");
        }

        mediaProjection = projectionManager.getMediaProjection(resultCode, data);

        AudioPlaybackCaptureConfiguration playbackConfig =
            new AudioPlaybackCaptureConfiguration.Builder(mediaProjection)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build();

        AudioFormat format =
            new AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(sampleRate)
                .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
                .build();

        int minBufferSize = AudioRecord.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_IN_STEREO,
            AudioFormat.ENCODING_PCM_16BIT
        );

        int bufferSize = Math.max(minBufferSize * 2, sampleRate * 4);

        audioRecord =
            new AudioRecord.Builder()
                .setAudioPlaybackCaptureConfig(playbackConfig)
                .setAudioFormat(format)
                .setBufferSizeInBytes(bufferSize)
                .build();

        if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
            throw new IllegalStateException("Android could not initialize playback audio capture.");
        }

        capturing = true;
        audioRecord.startRecording();
        captureExecutor = Executors.newSingleThreadExecutor();
        captureExecutor.execute(() -> readLoop(bufferSize));
    }

    private void readLoop(int bufferSize) {
        byte[] buffer = new byte[bufferSize];

        while (capturing && audioRecord != null) {
            int read = audioRecord.read(buffer, 0, buffer.length);

            if (read > 0 && captureListener != null) {
                byte[] copy = Arrays.copyOf(buffer, read);
                captureListener.onPcmChunk(copy, sampleRate, channelCount);
            }
        }
    }

    public synchronized void stopCapture() {
        capturing = false;

        if (captureExecutor != null) {
            captureExecutor.shutdownNow();
            captureExecutor = null;
        }

        if (audioRecord != null) {
            try {
                audioRecord.stop();
            } catch (Exception ignored) {
            }

            audioRecord.release();
            audioRecord = null;
        }

        if (mediaProjection != null) {
            mediaProjection.stop();
            mediaProjection = null;
        }

        if (captureListener != null) {
            captureListener.onCaptureStopped("capture-stopped");
        }
    }
}
