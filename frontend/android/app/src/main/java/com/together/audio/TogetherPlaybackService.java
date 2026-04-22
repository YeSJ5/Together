package com.together.audio;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

public class TogetherPlaybackService extends Service {
    public static final String ACTION_START = "com.together.audio.action.START";
    public static final String ACTION_STOP = "com.together.audio.action.STOP";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_TEXT = "text";

    private static final String CHANNEL_ID = "together_playback";
    private static final int NOTIFICATION_ID = 4207;

    public static void startForegroundService(Context context, String title, String text) {
        Intent intent = new Intent(context, TogetherPlaybackService.class);
        intent.setAction(ACTION_START);
        intent.putExtra(EXTRA_TITLE, title);
        intent.putExtra(EXTRA_TEXT, text);
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
            stopSelf();
            return START_NOT_STICKY;
        }

        createNotificationChannel();

        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : "TOGETHER active";
        String text = intent != null ? intent.getStringExtra(EXTRA_TEXT) : "Live audio is active in the background.";

        startForeground(NOTIFICATION_ID, buildNotification(title, text));
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
            .build();
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
}
