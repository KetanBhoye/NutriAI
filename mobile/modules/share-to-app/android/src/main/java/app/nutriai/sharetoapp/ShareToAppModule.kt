package app.nutriai.sharetoapp

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Hands an image to a *named* app via ACTION_SEND.
 *
 * This exists because expo-intent-launcher cannot express the intent Android
 * actually requires. ACTION_SEND carries its payload in `EXTRA_STREAM`, which
 * must be a Parcelable `Uri`; the JS bridge can only put primitives in extras,
 * so the Uri arrived as a String and the intent failed every time — verified
 * on a device, where the "direct" share silently fell through to the system
 * chooser. Building the Intent in Kotlin is the only way to put a real Uri in
 * there.
 *
 * Android-only by design. iOS has no equivalent: handing content to a specific
 * app needs that app's SDK (Snap's Creative Kit), and the sandbox offers no
 * general route, so the JS side falls back to the share sheet there.
 */
class ShareToAppModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ShareToApp")

    /**
     * True when the package is installed *and* visible to us. On Android 11+
     * visibility requires a <queries> entry in the manifest — without it this
     * returns false even for an installed app, which is exactly the failure
     * that makes a share button look broken rather than absent.
     */
    Function("isAppInstalled") { packageName: String ->
      val pm = appContext.reactContext?.packageManager ?: return@Function false
      try {
        pm.getPackageInfo(packageName, 0)
        true
      } catch (e: PackageManager.NameNotFoundException) {
        false
      }
    }

    /**
     * Throws rather than returning false on failure: the JS caller falls back
     * to the system share sheet, and a silent no-op would leave the user
     * tapping a button that does nothing.
     */
    AsyncFunction("shareImage") { uri: String, packageName: String, mimeType: String ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("No application context")

      val intent = Intent(Intent.ACTION_SEND).apply {
        type = mimeType
        setPackage(packageName)
        // The whole point of this module: a real Uri, not its toString().
        putExtra(Intent.EXTRA_STREAM, Uri.parse(uri))
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        // Started from outside an Activity context.
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }

      // resolveActivity respects package visibility, so this also catches the
      // missing-<queries> case with a message that says what is wrong.
      if (intent.resolveActivity(context.packageManager) == null) {
        throw IllegalStateException(
          "$packageName cannot receive $mimeType (not installed, or missing a <queries> entry)"
        )
      }

      context.startActivity(intent)
      true
    }
  }
}
