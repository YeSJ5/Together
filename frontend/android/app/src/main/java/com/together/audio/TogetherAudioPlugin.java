package com.together.audio;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "TogetherAudio")
public class TogetherAudioPlugin extends Plugin implements TogetherAudioManager.CaptureListener {
    private TogetherAudioManager audioManager;

    @Override
    public void load() {
        audioManager = TogetherAudioManager.getInstance(getContext());
        audioManager.setCaptureListener(this);
    }

    @PluginMethod
    public void getCapabilities(PluginCall call) {
        JSObject result = new JSObject();
        result.put("nativeAndroid", true);
        result.put("systemAudioCapture", audioManager.supportsSystemAudioCapture());
        result.put("backgroundPlaybackService", true);
        result.put("capturing", audioManager.isCapturing());
        result.put("sampleRate", audioManager.getSampleRate());
        result.put("channels", audioManager.getChannelCount());
        call.resolve(result);
    }

    @PluginMethod
    public void enableBackgroundPlayback(PluginCall call) {
        TogetherPlaybackService.startForegroundService(
            getContext(),
            "TOGETHER audio active",
            "Background playback mode is enabled."
        );
        call.resolve();
    }

    @PluginMethod
    public void disableBackgroundPlayback(PluginCall call) {
        TogetherPlaybackService.stopForegroundService(getContext());
        call.resolve();
    }

    @PluginMethod
    public void startSystemAudioCapture(PluginCall call) {
        if (!audioManager.supportsSystemAudioCapture()) {
            call.reject("System audio capture requires Android 10 or newer.");
            return;
        }

        MediaProjectionManager manager =
            (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);

        if (manager == null) {
            call.reject("MediaProjection is not available on this device.");
            return;
        }

        Intent captureIntent = manager.createScreenCaptureIntent();
        startActivityForResult(call, captureIntent, "handleProjectionPermission");
    }

    @ActivityCallback
    private void handleProjectionPermission(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }

        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Playback audio capture permission was denied.");
            return;
        }

        try {
            TogetherPlaybackService.startForegroundService(
                getContext(),
                "TOGETHER host active",
                "Sharing Android playback audio in the background."
            );
            audioManager.startCapture(result.getResultCode(), result.getData());

            JSObject response = new JSObject();
            response.put("started", true);
            response.put("sampleRate", audioManager.getSampleRate());
            response.put("channels", audioManager.getChannelCount());
            call.resolve(response);
        } catch (Exception error) {
            call.reject(error.getMessage());
        }
    }

    @PluginMethod
    public void stopSystemAudioCapture(PluginCall call) {
        audioManager.stopCapture();
        TogetherPlaybackService.stopForegroundService(getContext());
        call.resolve();
    }

    @Override
    public void onPcmChunk(byte[] data, int sampleRate, int channels) {
        JSObject payload = new JSObject();
        payload.put("sampleRate", sampleRate);
        payload.put("channels", channels);
        payload.put("chunkBase64", Base64.encodeToString(data, Base64.NO_WRAP));
        notifyListeners("pcmChunk", payload);
    }

    @Override
    public void onCaptureStopped(String reason) {
        JSObject payload = new JSObject();
        payload.put("reason", reason);
        notifyListeners("captureStopped", payload);
    }
}
