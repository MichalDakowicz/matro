package expo.modules.matrokeepalive

import android.content.Context
import android.content.Intent
import android.os.PowerManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MatroKeepAliveModule : Module() {
  private var running = false

  override fun definition() = ModuleDefinition {
    Name("MatroKeepAlive")

    // percent < 0 shows an indeterminate bar.
    Function("show") { title: String, text: String, percent: Int ->
      val context = appContext.reactContext ?: return@Function false
      try {
        OfflineService.show(context, title, text, percent, running)
        running = true
        true
      } catch (error: Exception) {
        // The OS refused a foreground service (e.g. started while the app was already backgrounded).
        running = false
        false
      }
    }

    Function("hide") {
      val context = appContext.reactContext ?: return@Function null
      context.stopService(Intent(context, OfflineService::class.java))
      running = false
      null
    }

    // Battery saver: glass drops its backdrop blur and keeps the solid fill.
    Function("powerSaveMode") {
      val context = appContext.reactContext ?: return@Function false
      (context.getSystemService(Context.POWER_SERVICE) as PowerManager).isPowerSaveMode
    }
  }
}
