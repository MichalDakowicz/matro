package expo.modules.matrovolumeboost

import android.media.audiofx.LoudnessEnhancer
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.video.player.VideoPlayer
import java.lang.ref.WeakReference

/**
 * Gain above 100% for an expo-video player. LoudnessEnhancer sits on the player's own audio session
 * and limits its output, so boosted peaks are compressed instead of clipping hard. Everything runs on
 * the main thread, where the ExoPlayer lives.
 */
@OptIn(UnstableApi::class)
class MatroVolumeBoostModule : Module() {
  private var target = WeakReference<VideoPlayer>(null)
  private var enhancer: LoudnessEnhancer? = null
  private var gain = 0

  // ExoPlayer can move to a new audio session (new audio track); the effect follows it.
  private val listener = object : Player.Listener {
    override fun onAudioSessionIdChanged(audioSessionId: Int) = attach(audioSessionId)
  }

  private fun attach(session: Int) {
    enhancer?.release()
    enhancer = null
    if (gain <= 0 || session == C.AUDIO_SESSION_ID_UNSET) return
    enhancer = try {
      LoudnessEnhancer(session).apply { setTargetGain(gain); enabled = true }
    } catch (error: RuntimeException) {
      // Some devices refuse the effect; playback continues at 100%.
      null
    }
  }

  private fun release() {
    target.get()?.player?.removeListener(listener)
    target = WeakReference(null)
    enhancer?.release()
    enhancer = null
    gain = 0
  }

  override fun definition() = ModuleDefinition {
    Name("MatroVolumeBoost")

    AsyncFunction("setGain") { player: VideoPlayer, millibels: Int ->
      if (target.get() !== player) {
        release()
        target = WeakReference(player)
        player.player.addListener(listener)
      }
      gain = millibels.coerceIn(0, 2000)
      val current = enhancer
      if (current != null && gain > 0) current.setTargetGain(gain) else attach(player.player.audioSessionId)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("release") { release() }.runOnQueue(Queues.MAIN)
  }
}
