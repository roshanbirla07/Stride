# Stride pilot

One cross-platform mobile app (Night Arena design) and a small Python/SQLite API for a private 3–4 person step challenge. No shop, teams, or other secondary features yet.

## Rules

- All challenge days use **Asia/Kolkata**. Midnight ends the day; uploads for yesterday close at **00:30 IST**.
- Leaderboards show daily, calendar week (Monday onward), and calendar month totals. A day finalizes at 00:30 IST.
- A top-step tie splits the 100-coin daily prize; a bottom-step tie is not penalized. With fewer than two verified participants, neither prize nor penalty applies.
- One verified last place gets **−10 points**; on each third consecutive last-place day the user gets another **−50 points**. Coins and points are separate.
- A user without a confirmed upload for the day is unverified and receives no last-place penalty. Finalization is transactional and safe to rerun.
- This is a **pilot**, not an anti-cheat implementation: an altered client can forge uploaded totals. Do not attach valuable rewards until ingestion and abuse controls are designed.

## Start backend

Requires Python 3.11+; no pip packages.

```sh
cd server
python3 app.py
```

For a local end-to-end test, enter the reachable HTTPS reverse proxy URL for port 8000 on the mobile sign-in screen. Never expose the SQLite file or run the development server as a public production deployment. The file path is configurable via `STRIDE_DB`.

```sh
cd server
python3 -m unittest -v
curl http://localhost:8000/health
```

At **00:30 IST** run `python3 /path/to/server/app.py settle` from cron or a systemd timer; the job defaults to yesterday. Example cron on an IST-configured host:

```cron
30 0 * * * /usr/bin/python3 /srv/stride/server/app.py settle >> /var/log/stride-settlement.log 2>&1
```

On a UTC host the equivalent schedule is **19:00 UTC** on the previous calendar date. The app uses its own IST clock to choose the settlement day. Use a backup of the SQLite file and a single shared backend instance for the pilot.

## Mobile setup and install

Requires Node 22.13+, an Expo/EAS account, Android build tooling or EAS Build, and an Apple Developer Program account for distributing iPhone builds through TestFlight. Native health libraries **do not work in Expo Go**.

```sh
cd mobile
npm install
npx expo install --fix
npx expo-doctor
EXPO_PUBLIC_API_URL=https://your-api.example.com npx expo start --dev-client
```

Enter your backend HTTPS URL on the first screen (or set `EXPO_PUBLIC_API_URL` as a build-time default). For Android, `npx eas build --platform android --profile pilot` creates an installable internal APK. For iOS, `npx eas build --platform ios --profile testflight`, then submit through App Store Connect and invite your testers via TestFlight. External TestFlight beta review may be required. Configure signing in EAS or Xcode.

The app requests read-only steps, syncs the current day on demand, and attempts yesterday again during 00:00–00:29 IST when opened. It also resyncs when brought to foreground after the user connected. Phone background execution is not guaranteed at midnight. For this pilot, each participant should open the app before the cutoff; missing uploads remain unverified.

## Verify on devices

1. Install on one Android phone and one iPhone, create separate accounts, and grant read access.
2. Add recorded steps to Health Connect / Apple Health, tap **Connect health & sync steps**, and confirm matching totals and ranks.
3. Deny permission and verify the app displays an error rather than uploading a fabricated total.
4. Disconnect a phone and verify no upload; reconnect and sync before the cutoff.
5. After 00:30 IST, execute the settlement worker twice and confirm the second reports `alreadySettled`. Check the coin and point totals in the app.

The API and settlement tests run locally. Native builds, store signing, and physical HealthKit/Health Connect reads must be checked on actual devices.
