package expo.modules.matrokeepalive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

// Android freezes a backgrounded app within seconds, which silently kills a running offline download.
// A foreground service keeps the process alive and doubles as the progress notification.
class OfflineService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = build(this, intent?.getStringExtra("title") ?: "Saving offline", intent?.getStringExtra("text") ?: "", intent?.getIntExtra("percent", -1) ?: -1)
    if (Build.VERSION.SDK_INT >= 29) startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    else startForeground(ID, notification)
    return START_NOT_STICKY
  }

  companion object {
    private const val ID = 7341
    private const val CHANNEL = "offline-service"

    fun build(context: Context, title: String, text: String, percent: Int): Notification {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL) == null) {
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Offline downloads", NotificationManager.IMPORTANCE_LOW))
      }
      val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val tap = open?.let { PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
      val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, CHANNEL) else Notification.Builder(context)
      builder.setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle(title).setContentText(text)
        .setOngoing(true).setOnlyAlertOnce(true).setContentIntent(tap)
      if (percent >= 0) builder.setProgress(100, percent, false) else builder.setProgress(0, 0, true)
      return builder.build()
    }

    // Updates go straight to the notification manager so they also work while the app is in the background.
    fun show(context: Context, title: String, text: String, percent: Int, running: Boolean) {
      if (running) {
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(ID, build(context, title, text, percent))
      } else {
        context.startForegroundService(Intent(context, OfflineService::class.java).putExtra("title", title).putExtra("text", text).putExtra("percent", percent))
      }
    }
  }
}
