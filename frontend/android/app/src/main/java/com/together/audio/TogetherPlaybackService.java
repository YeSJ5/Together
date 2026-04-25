package com.together.audio;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

public class TogetherPlaybackService extends Service {
    public static final String ACTION_START = "com.together.audio.action.START";
    public static final String ACTION_STOP = "com.together.audio.action.STOP";
    public static final String ACTION_UPDATE = "com.together.audio.action.UPDATE";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_TEXT = "text";
    public static final String EXTRA_PLAYING = "playing";

    private static final String CHANNEL_ID = "together_playback";
    private static final int NOTIFICATION_ID = 4207;

    private MediaSessionCompat mediaSession;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private boolean hasAudioFocus = false;

    public static void startForegroundService(Context context, String title, String text) {
        startForegroundService(context, title, text, true);
    }

    public static void startForegroundService(
        Context context,
        String title,
        String text,
        boolean playing
    ) {
        Intent intent = new Intent(context, TogetherPlaybackService.class);
        intent.setAction(ACTION_START);
        intent.putExtra(EXTRA_TITLE, title);
        intent.putExtra(EXTRA_TEXT, text);
        intent.putExtra(EXTRA_PLAYING, playing);
        ContextCompat.startForegroundService(context, intent);
    }

    public static void updateForegroundService(
        Context context,
        String title,
        String text,
        boolean playing
    ) {
        Intent intent = new Intent(context, TogetherPlaybackService.class);
        intent.setAction(ACTION_UPDATE);
        intent.putExtra(EXTRA_TITLE, title);
        intent.putExtra(EXTRA_TEXT, text);
        intent.putExtra(EXTRA_PLAYING, playing);
        ContextCompat.startForegroundService(context, intent);
    }

    public static void stopForegroundService(Context context) {
        Intent intent = new Intent(context, TogetherPlaybackService.class);
        intent.setAction(ACTION_STOP);
        context.startService(intent);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : ACTION_START;

        if (ACTION_STOP.equals(action)) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            releaseAudioFocus();
            releaseMediaSession();
            stopSelf();
            return START_NOT_STICKY;
        }

        createNotificationChannel();
        ensureMediaSession();
        requestAudioFocus();

        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : "TOGETHER active";
        String text = intent != null ? intent.getStringExtra(EXTRA_TEXT) : "Live audio is active in the background.";
        boolean playing = intent == null || intent.getBooleanExtra(EXTRA_PLAYING, true);

        updatePlaybackState(playing);
        Notification notification = buildNotification(title, text);

        if (ACTION_UPDATE.equals(action)) {
            NotificationManager notificationManager =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (notificationManager != null) {
                notificationManager.notify(NOTIFICATION_ID, notification);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            return START_STICKY;
        }

        startForeground(NOTIFICATION_ID, notification);
        return START_STICKY;
    }

    private Notification buildNotification(String title, String text) {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setStyle(
                new MediaStyle()
                    .setMediaSession(mediaSession != null ? mediaSession.getSessionToken() : null)
            )
            .build();
    }

    private void ensureMediaSession() {
        if (mediaSession != null) {
            return;
        }

        mediaSession = new MediaSessionCompat(this, "TogetherPlaybackService");
        mediaSession.setActive(true);
        mediaSession.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS
                | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
    }

    private void updatePlaybackState(boolean playing) {
        if (mediaSession == null) {
            return;
        }

        long actions =
            PlaybackStateCompat.ACTION_PLAY
                | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_STOP;

        int state = playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;

        mediaSession.setPlaybackState(
            new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(state, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 1f)
                .build()
        );
    }

    private void requestAudioFocus() {
        if (hasAudioFocus) {
            return;
        }

        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (audioManager == null) {
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (audioFocusRequest == null) {
                audioFocusRequest =
                    new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                        .setAudioAttributes(
                            new AudioAttributes.Builder()
                                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                                .setUsage(AudioAttributes.USAGE_MEDIA)
                                .build()
                        )
                        .setAcceptsDelayedFocusGain(true)
                        .build();
            }

            hasAudioFocus =
                audioManager.requestAudioFocus(audioFocusRequest)
                    == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        } else {
            hasAudioFocus =
                audioManager.requestAudioFocus(
                        null,
                        AudioManager.STREAM_MUSIC,
                        AudioManager.AUDIOFOCUS_GAIN
                    )
                    == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        }
    }

    private void releaseAudioFocus() {
        if (!hasAudioFocus || audioManager == null) {
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest);
        } else {
            audioManager.abandonAudioFocus(null);
        }

        hasAudioFocus = false;
    }

    private void releaseMediaSession() {
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "TOGETHER Playback",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Keeps TOGETHER audio active in the background.");

        NotificationManager notificationManager = getSystemService(NotificationManager.class);
        if (notificationManager != null) {
            notificationManager.createNotificationChannel(channel);
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        releaseAudioFocus();
        releaseMediaSession();
        super.onDestroy();
    }
}
