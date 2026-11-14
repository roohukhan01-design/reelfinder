# Reelfinder

An Android app with its own design. It talks to **one Telegram movie-search bot** that you choose.
You type a movie name. The bot's answer shows as cards with link buttons.

Reelfinder does **not** host or sell movies. Use only bots and links you are allowed to use.

## How it connects to Telegram

A Telegram bot cannot send messages to another bot. So the app logs in as **you** (your Telegram account) with MTProto (GramJS).

You need an **API ID** and **API hash**:
1. Open https://my.telegram.org and log in.
2. Choose "API development tools" and create an app.
3. Copy the API ID and API hash.

You type them in the app on first start. They are saved in the Android secure store. They are **not** in this code. Never put them in GitHub.
Tip: use a spare Telegram account. Telegram can limit accounts that send too many messages.

## Build the APK with GitHub (no computer tools needed)

1. Make a new **private** GitHub repository.
2. Upload all files from this project. Keep the folders.
   - Important: `.github/workflows/build-apk.yml` must keep this exact path.
   - On a phone you can use "Add file > Create new file", type `.github/workflows/build-apk.yml` as the name, and paste the file text.
3. Open the **Actions** tab. Choose **Build APK**. Press **Run workflow**. (It also runs on every push to `main`.)
4. Wait about 10 to 15 minutes.
5. Open the finished run. Under **Artifacts**, download `reelfinder-debug-apk`. Unzip it. Install `app-debug.apk`.
6. If it fails, open the red step and read the error. Download the `gradle-reports` artifact if it is there.

## What the build does

`npm install` > `vite build` (web files into `www/`) > `cap add android` (first run) > `scripts/prepare-android.mjs` (icons, splash, safer manifest) > `cap sync` > `gradlew assembleDebug` > upload APK.

The `android/` folder is made by the workflow, so the Gradle wrapper and native files always match Capacitor 6. It is in `.gitignore`.

## Files

- `index.html`, `src/` - the app (screens, Telegram code, secure storage)
- `capacitor.config.json`, `vite.config.js`, `package.json` - settings
- `android-overlay/res/` - launcher icons, adaptive icon, splash
- `scripts/generate-icons.py` - makes the icons again if you want to change them
- `scripts/prepare-android.mjs` - applies the overlay to the Android project
- `.github/workflows/build-apk.yml` - the APK builder

## Safety notes

- API keys and the Telegram session are stored with the Android secure store plugin.
- App backups are turned off. Plain http traffic is turned off.
- Log out in Settings to delete the saved session. You can also end the session in Telegram: Settings > Devices.
- Debug APK only. A release APK needs your own signing key (never upload it to GitHub).

## Not tested yet

This code was written without internet access. The APK build was **not run**. See the notes in the chat. If a step fails, send the error text and it can be fixed.
