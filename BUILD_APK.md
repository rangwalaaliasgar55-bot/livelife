# Building the Android APK

The repo contains a complete Capacitor Android project (`android/`). There are three ways to get an APK.

## 1. CI (no local setup needed)

Push to `main` (or tag `v*`). The workflow `.github/workflows/android-apk.yml` builds a debug APK and uploads it as the
`aurelion-debug-apk` artifact. Download it from GitHub → Actions → run → Artifacts, and install it on the phone
(allow "install unknown apps" for the downloader).

## 2. Android Studio

1. Install Android Studio (it bundles the JDK + Android SDK).
2. Open the `android/` folder.
3. Run `npm install` and `npm run apk` in the repo root (produces `out/` and syncs web assets into `android/`).
4. In Android Studio: **Run ▶** (emulator or device) or **Build → Build APK(s)**.
5. The APK lands in `android/app/build/outputs/apk/`.

## 3. Command line

Prerequisites: **JDK 17**, **Android SDK** (platform 36 + build-tools 36).

```bash
npm install
npm run apk                  # static web build + cap sync android
cd android
./gradlew assembleDebug      # → app/build/outputs/apk/debug/app-debug.apk
```

### Notes

- `scripts/build-static.sh` temporarily moves `src/app/api` and `src/app/play/[id]` aside while building `out/` (API routes and
  dynamic segments are unsupported in Next.js static export), then restores them. The static app is 100% client-side.
- The app needs no permissions beyond INTERNET (which it doesn't even need once offline). Saves live in the WebView's localStorage.
- `app-debug.apk` is signed with the Android debug key — fine for personal use. For Play Store distribution, generate a keystore and
  configure a `release` signing block in `android/app/build.gradle`.
