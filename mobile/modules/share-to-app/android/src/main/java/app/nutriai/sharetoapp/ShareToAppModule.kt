package app.nutriai.sharetoapp

import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import org.json.JSONObject
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

    /**
     * Sends the card to Snapchat as a *Snap*, not a chat attachment.
     *
     * `shareImage` above hands Snapchat a plain ACTION_SEND, which its generic
     * share receiver turns into the "Send To" flow — the picture arrives in a
     * chat, as a message. That is not what a share button on a story card is
     * for, and it was the behaviour on a real device.
     *
     * Creative Kit Lite is the documented route to the camera preview: the
     * editor where the recipient list, the Story option and Snapchat's own
     * creative tools live. Mechanically it is the same ACTION_SEND, and the
     * three additions below are the entire difference:
     *
     *   - the intent *data* is `snapchat://creativekit/preview`, which selects
     *     the preview entry point rather than the share receiver;
     *   - `CLIENT_ID` identifies the calling app. Snapchat ignores the deep
     *     link without it and falls back to the chat flow, which is why this
     *     cannot be done anonymously;
     *   - `CLIENT_APP_NAME` is the attribution Snapchat prints on the Snap.
     *
     * See https://github.com/Snapchat/creative-kit (Creative Kit Lite). No SDK
     * is involved — the contract is this Intent.
     */
    AsyncFunction("shareSnapToPreview") { uri: String, clientId: String, appName: String, caption: String? ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("No application context")

      if (clientId.isBlank()) {
        throw IllegalStateException("No Snap Creative Kit client ID configured")
      }

      val fileUri = Uri.parse(uri)
      val intent = Intent(Intent.ACTION_SEND).apply {
        setPackage(SNAPCHAT_PACKAGE)
        // setDataAndType, not `type =`: setting the type alone clears the data
        // Uri, and losing it is exactly what silently demotes this back to a
        // chat attachment.
        setDataAndType(Uri.parse(CREATIVE_KIT_PREVIEW), "image/*")
        putExtra(CLIENT_ID_EXTRA, clientId)
        putExtra(CLIENT_APP_NAME_EXTRA, appName)
        putExtra(Intent.EXTRA_STREAM, fileUri)
        if (!caption.isNullOrBlank()) putExtra(CAPTION_TEXT_EXTRA, caption)
        /**
         * How Snapchat gets back to us when the user finishes or cancels.
         *
         * Snap's reference implementation sets this on every Creative Kit
         * intent, so it is part of the contract rather than an optional extra —
         * matched here rather than trimmed, because the failure mode for
         * getting this wrong is Snapchat quietly treating the intent as an
         * ordinary share, which is indistinguishable from the bug being fixed.
         *
         * FLAG_IMMUTABLE is required from Android 12; the PendingIntent carries
         * an empty Intent because we want the callback, not a destination.
         */
        putExtra(
          RESULT_INTENT_EXTRA,
          PendingIntent.getActivity(
            context,
            CREATIVE_KIT_REQUEST_CODE,
            Intent(),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_IMMUTABLE
            else PendingIntent.FLAG_ONE_SHOT
          )
        )
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }

      if (intent.resolveActivity(context.packageManager) == null) {
        throw IllegalStateException(
          "Snapchat cannot receive a Creative Kit preview (not installed, too old, or missing a <queries> entry)"
        )
      }

      /**
       * The flag alone is not always enough.
       *
       * FLAG_GRANT_READ_URI_PERMISSION grants against the intent's *data* Uri,
       * and here the data is the creativekit deep link — the image rides in
       * EXTRA_STREAM instead. An explicit grant to Snapchat covers it; without
       * this the preview can open on an empty canvas, which looks like the card
       * failed to render rather than like a permissions problem.
       */
      context.grantUriPermission(SNAPCHAT_PACKAGE, fileUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      context.startActivity(intent)
      true
    }

    /**
     * Opens Snapchat's *camera* with the card attached as a sticker.
     *
     * The other direction entirely from `shareSnapToPreview`. There, our card
     * is the Snap and the user's only choice is whether to send it. Here the
     * card is an overlay and the background is theirs — they point the camera
     * at the meal, or pick any photo, and our design floats on top of it.
     *
     * Worth the second entry point because it changes what the thing *is*: a
     * full-frame card posted to a Story is an advert with someone's numbers on
     * it, while a sticker over their own photo is their post, which we happened
     * to caption. The second gets shared; the first gets skipped.
     *
     * The sticker PNG must have a transparent background — see the note in
     * StickerFrame.tsx. A card captured with its own background works here but
     * looks like a screenshot pasted over the photo.
     *
     * Position and size are fractions and dp respectively, matching Snap's
     * documented sticker JSON. The defaults put it slightly above centre, where
     * it covers the least of a typical hand-held food shot.
     */
    AsyncFunction("shareSnapSticker") {
      uri: String,
      clientId: String,
      appName: String,
      widthDp: Int,
      heightDp: Int,
      posY: Double
      ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("No application context")

      if (clientId.isBlank()) {
        throw IllegalStateException("No Snap Creative Kit client ID configured")
      }

      val stickerUri = Uri.parse(uri)
      val sticker = JSONObject().apply {
        put("uri", stickerUri.toString())
        put("posX", 0.5)
        put("posY", posY)
        put("rotation", 0)
        put("widthDp", widthDp)
        put("heightDp", heightDp)
      }

      val intent = Intent(Intent.ACTION_SEND).apply {
        setPackage(SNAPCHAT_PACKAGE)
        // The camera deep link, not the preview one: that is the whole
        // difference between "here is your Snap" and "here is your sticker,
        // now go take a Snap".
        setDataAndType(Uri.parse(CREATIVE_KIT_CAMERA), INTENT_TYPE_ALL)
        putExtra(CLIENT_ID_EXTRA, clientId)
        putExtra(CLIENT_APP_NAME_EXTRA, appName)
        putExtra(STICKER_EXTRA, sticker.toString())
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
        putExtra(
          RESULT_INTENT_EXTRA,
          PendingIntent.getActivity(
            context,
            CREATIVE_KIT_REQUEST_CODE,
            Intent(),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_IMMUTABLE
            else PendingIntent.FLAG_ONE_SHOT
          )
        )
      }

      if (intent.resolveActivity(context.packageManager) == null) {
        throw IllegalStateException(
          "Snapchat cannot receive a Creative Kit sticker (not installed, too old, or missing a <queries> entry)"
        )
      }

      // The sticker rides in an extra rather than the intent data, so the flag
      // above does not cover it. Same reasoning as the preview flow.
      context.grantUriPermission(SNAPCHAT_PACKAGE, stickerUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      context.startActivity(intent)
      true
    }
  }

  private companion object {
    const val SNAPCHAT_PACKAGE = "com.snapchat.android"
    const val CREATIVE_KIT_PREVIEW = "snapchat://creativekit/preview"
    const val CREATIVE_KIT_CAMERA = "snapchat://creativekit/camera"
    const val INTENT_TYPE_ALL = "*/*"
    const val STICKER_EXTRA = "sticker"
    const val CLIENT_ID_EXTRA = "CLIENT_ID"
    const val CLIENT_APP_NAME_EXTRA = "CLIENT_APP_NAME"
    const val CAPTION_TEXT_EXTRA = "captionText"
    const val RESULT_INTENT_EXTRA = "RESULT_INTENT"
    const val CREATIVE_KIT_REQUEST_CODE = 100
  }
}
