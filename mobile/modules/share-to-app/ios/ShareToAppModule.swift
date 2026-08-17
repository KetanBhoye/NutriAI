import ExpoModulesCore
import SCSDKCreativeKit
import UIKit

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
        let url = URL(string: uri),
        let data = try? Data(contentsOf: url),
        let image = UIImage(data: data)
      else {
        promise.resolve(false)
        return
      }

      DispatchQueue.main.async {
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

        // Constructed per send rather than held: the API object is cheap, and a
        // retained one outlives the client ID if that ever becomes dynamic.
        let api = SCSDKSnapAPI()
        api.startSending(content) { error in
          // Snapchat missing, too old, or a client ID the portal has not
          // approved for this bundle. All of them mean "fall back".
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

     `widthDp`/`heightDp`/`posY` are accepted and mostly ignored here, unlike
     Android where they are the sticker JSON. iOS sizes the sticker from the
     image itself and lets the user drag it, so the arguments exist to keep one
     signature across both platforms rather than making every caller branch.
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
        promise.resolve(false)
        return
      }

      guard
        let url = URL(string: uri),
        let data = try? Data(contentsOf: url),
        let image = UIImage(data: data)
      else {
        promise.resolve(false)
        return
      }

      DispatchQueue.main.async {
        let content = SCSDKNoSnapContent()
        let sticker = SCSDKSnapSticker(stickerImage: image)
        sticker.posY = CGFloat(posY)
        content.sticker = sticker
        content.attachmentUrl = "https://nutriai-app.up.railway.app/download"

        let api = SCSDKSnapAPI()
        api.startSending(content) { error in
          promise.resolve(error == nil)
        }
      }
    }
  }
}
