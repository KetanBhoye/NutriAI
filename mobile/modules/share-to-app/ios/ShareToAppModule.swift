import ExpoModulesCore
import OSLog
import SCSDKCreativeKit
import UIKit

/**
 Why a share fell back, in Console.

 Every failure path here resolves `false` so the caller can drop to the share
 sheet, which is the right behaviour and also completely silent — the user sees
 the system sheet and cannot tell whether Snapchat is missing, the client ID is
 unapproved, or the card failed to render. All three look identical, and the
 last two are our bugs. Logged at `error` level so it survives in a release
 build and can be read with `log stream --predicate 'subsystem == "app.nutriai.mobile"'`.
 */
private let shareLog = Logger(subsystem: "app.nutriai.mobile", category: "share-to-app")

/**
 Also NSLog, not only os_log.

 os_log is the right home for this — it survives in release builds and is
 readable in Console.app — but it is *not* forwarded to a device's stdout, which
 is the only stream reachable over a cable with `devicectl process launch
 --console`. Diagnosing this on a real phone meant seeing nothing at all. NSLog
 reaches both, and the volume here is a handful of lines per share.
 */
private func shareDiag(_ message: String) {
  shareLog.error("\(message, privacy: .public)")
  NSLog("[share-to-app] %@", message)
}

/**
 Whether Snapchat is even on this phone.

 Creative Kit fails with the same opaque error whether Snapchat is missing or
 the client ID is unapproved, and those are wildly different problems: one is a
 config fix, the other means there is nothing to debug. `canOpenURL` needs
 `snapchat` in LSApplicationQueriesSchemes, which withSnapCreativeKit adds.
 */

/**
 Turns whatever the JS side hands us into a readable file URL.

 react-native-view-shot returns a *bare filesystem path* on iOS
 (`/private/var/mobile/.../tmp/ReactNative/xxx.png`), while Android returns a
 `content://` URI. `URL(string:)` requires a scheme, so it quietly produced a
 useless relative URL for the iOS form, `Data(contentsOf:)` failed, and the
 share bailed out *before Creative Kit was ever called* — which looked
 identical to Snapchat rejecting us, and sent the debugging off after the
 client ID and the portal for hours.

 `URL(fileURLWithPath:)` is the right constructor for a path, and the scheme
 check is what decides which one applies.
 */
private func readableFileURL(_ uri: String) -> URL? {
  if let url = URL(string: uri), url.scheme != nil { return url }
  return URL(fileURLWithPath: uri)
}

/**
 Keeps the Creative Kit API alive until it answers.

 `SCSDKSnapAPI` does not retain itself across `startSending`. Created as a local
 it is released the moment the enclosing block returns, and the completion
 handler is then simply never called — no error, no callback, nothing. On screen
 that was a share button stuck on "Preparing…" forever, and in the log it was a
 line saying the send had started followed by silence.

 Held here for the lifetime of the call and cleared in the completion. Only one
 share can be in flight at a time (the UI disables itself while `sharing` is
 true), so a single slot is enough, and it is only ever touched on the main
 queue.
 */
private var inFlightSnapAPI: SCSDKSnapAPI?

private func snapchatInstalled() -> Bool {
  guard let url = URL(string: "snapchat://") else { return false }
  return UIApplication.shared.canOpenURL(url)
}

/**
 Hands a captured card to Snapchat as a *Snap*, not a chat attachment.

 The iOS half of the Android module next door, and deliberately not a port of
 it: Android can reach Snapchat's camera preview with a bare Intent, while iOS
 has no equivalent — the sandbox offers no way to hand content to a named app,
 so Creative Kit's SDK is the only route. What the two share is the outcome and
 the failure mode.

 The failure mode is worth stating, because it is invisible: `UIActivityViewController`
 (the system share sheet) *does* offer Snapchat, and Snapchat *does* accept the
 image — as a chat message, with no editor and no Story option. It looks like a
 working share right up until someone receives one. That is what this replaces.

 Everything here degrades rather than throws. The JS caller branches on the
 returned boolean and falls back to the share sheet, so returning false is how
 this says "use the old path" — a thrown error would break that chain and leave
 the user with a button that does nothing.
 */
public class ShareToAppModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ShareToApp")

    /**
     Android reports which apps are installed so the caller can hide a dead
     button. iOS cannot answer that honestly without declaring every scheme in
     `LSApplicationQueriesSchemes`, and the answer would not change what this
     module does — Creative Kit reports its own failure when Snapchat is
     missing. Always false, matching the JS contract.
     */
    Function("isAppInstalled") { (_: String) -> Bool in
      false
    }

    /**
     The Android-only direct-send intent. No iOS equivalent exists; the JS side
     never calls this on iOS, and it is defined only so the native module's
     shape is identical on both platforms.
     */
    AsyncFunction("shareImage") { (_: String, _: String, _: String) -> Bool in
      false
    }

    AsyncFunction("shareSnapToPreview") { (
      uri: String,
      clientId: String,
      appName: String,
      caption: String?,
      promise: Promise
    ) in
      guard !clientId.isEmpty else {
        shareDiag("snap preview: no Creative Kit client ID in this build")
        promise.resolve(false)
        return
      }

      /**
       The card is captured to a file by react-native-view-shot, so it arrives
       as a URL rather than an image. Loading it here rather than passing the
       URL to `SCSDKSnapPhoto(imageUrl:)` is deliberate: that initialiser
       expects a URL the SDK can read later, and a temp file the OS may have
       already reclaimed produces an empty preview — the same "card failed to
       render" symptom the Android side has to guard against with an explicit
       URI permission grant.
       */
      guard
        let url = readableFileURL(uri),
        let data = try? Data(contentsOf: url),
        let image = UIImage(data: data)
      else {
        shareDiag("snap preview: could not load the captured card from \(uri)")
        promise.resolve(false)
        return
      }

      DispatchQueue.main.async {
        shareDiag("snap preview: clientId=\(clientId.prefix(8))… snapchatInstalled=\(snapchatInstalled())")
        let photo = SCSDKSnapPhoto(image: image)
        let content = SCSDKPhotoSnapContent(snapPhoto: photo)

        if let caption, !caption.isEmpty {
          content.caption = caption
        }
        /**
         The swipe-up link on the Snap.

         This is the native version of the download URL that used to be printed
         along the bottom of the card: a recipient swipes up and lands on the
         install page, rather than squinting at a URL and typing it. It also
         means the card art no longer has to carry it.
         */
        content.attachmentUrl = "https://nutriai-app.up.railway.app/download"

        let api = SCSDKSnapAPI()
        inFlightSnapAPI = api
        api.startSending(content) { error in
          inFlightSnapAPI = nil
          // Snapchat missing, too old, or a client ID the portal has not
          // approved for this bundle. All of them mean "fall back" — but they
          // are very different bugs, so say which one.
          if let error {
            shareDiag("snap preview FAILED: \(String(describing: error))")
          } else {
            shareDiag("snap preview opened OK")
          }
          promise.resolve(error == nil)
        }
      }
    }

    /**
     Opens Snapchat's camera with the card riding as a sticker on top.

     `SCSDKNoSnapContent` is the iOS equivalent of Android's camera deep link:
     content with no photo of its own, which lands the user in the camera rather
     than the preview. The sticker is the payload, and the background is
     whatever they shoot or pick.

     `width` and `height` are in *points* and must be set explicitly. Left
     unset, Creative Kit sizes the sticker from the UIImage, which is in
     *pixels* — a 1080×1920 export became a 1080×1920-point sticker on a
     393-point-wide screen, so only a fragment of it was visible and the rest
     ran off every edge. The caller knows the frame it wants to fill, so the
     size comes from there rather than from the bitmap.
     */
    AsyncFunction("shareSnapSticker") { (
      uri: String,
      clientId: String,
      appName: String,
      widthDp: Int,
      heightDp: Int,
      posY: Double,
      promise: Promise
    ) in
      guard !clientId.isEmpty else {
        shareDiag("snap sticker: no Creative Kit client ID in this build")
        promise.resolve(false)
        return
      }

      guard
        let url = readableFileURL(uri),
        let data = try? Data(contentsOf: url),
        let image = UIImage(data: data)
      else {
        shareDiag("snap sticker: could not load the captured sticker from \(uri)")
        promise.resolve(false)
        return
      }

      DispatchQueue.main.async {
        let content = SCSDKNoSnapContent()
        let sticker = SCSDKSnapSticker(stickerImage: image)
        sticker.width = CGFloat(widthDp)
        sticker.height = CGFloat(heightDp)
        sticker.posX = 0.5
        sticker.posY = CGFloat(posY)
        content.sticker = sticker
        content.attachmentUrl = "https://nutriai-app.up.railway.app/download"

        let api = SCSDKSnapAPI()
        inFlightSnapAPI = api
        api.startSending(content) { error in
          inFlightSnapAPI = nil
          if let error {
            shareDiag("snap sticker FAILED: \(String(describing: error))")
          } else {
            shareDiag("snap sticker opened OK")
          }
          promise.resolve(error == nil)
        }
      }
    }
  }
}
