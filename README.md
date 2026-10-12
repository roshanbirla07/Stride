# Stride pilot

Android app, iPhone web/Shortcuts pilot, and a small Python/SQLite API for private step challenges. One account may belong to several groups. No shop or other secondary features yet.

## Rules

- All challenge date ranges use **Asia/Kolkata** and end at **00:00 IST**. Weeks start Monday; months start on the first.
- Refresh reads the full selected range from the device health provider and replaces its latest total; it does not depend on previous daily Stride uploads.
- Each member/group/period retains one latest total for ranking while members are offline. The refresh timestamp is visible. Equal step totals share a rank.
- Membership becomes active the next IST day; earlier steps do not count toward that group.
- Daily rewards and penalties are paused because latest-only totals do not retain the history needed for settlement. Existing balances and historical records are preserved.
- This remains a pilot: a modified client can forge totals. Data reflects the configured health provider and permissions, not necessarily every vendor app's displayed count.

## Groups

On the web page or updated Android app, open **Manage groups** to create a named group or join with an eight-character invite code. Select a group to view its standings and wallet. Members can share its code; the group creator can regenerate it. A user can join several groups, such as office and home. Existing users move into **Original crew** automatically when the backend first starts with the new schema. Their prior finalized results and balances are copied into that group once. New accounts start with no group and can create or join one.

API: `GET /groups`, `POST /groups` with `{ "name": "Office" }`, `POST /groups/join` with `{ "code": "..." }`, `POST /groups/rotate` with `{ "groupId": 2 }`, and `GET /leaderboard?period=day&day=YYYY-MM-DD&groupId=2`. All need the regular account bearer token. Shortcut uploads still use their own restricted token and need no group ID.

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

Daily reward settlement is **paused** for latest-only refresh. Disable any existing settlement cron/systemd timer before deploying. The `settle` CLI exits with an explanation instead of creating daily result/ledger records from stale totals. Existing balances and historical records are preserved; new refreshes do not award or deduct coins/points.

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

The native app remembers each account’s health connection and refreshes on opening, returning to the foreground, changing groups, or choosing Today/Week/Month. It reads the entire selected period from Health Connect / Apple Health through the current time, rather than summing past Stride uploads. Calendar weeks start Monday; calendar months start on the first, all in IST. Group totals start at the later of the period start and the member’s effective date.

`POST /leaderboard/refresh` accepts `{groupId, period, day, from, steps, source, readAt}`. The backend validates membership and the required range, replaces only that member’s latest aggregate for that group/period, and recalculates tied ranks. Native requests include the health read timestamp; delayed older refreshes cannot overwrite a newer snapshot. No raw health samples or daily backfill are uploaded. Latest aggregates are retained for members whose phones are offline, with an Updated timestamp; these are not guaranteed live. Snapshots from a previous week/month are excluded after rollover. Legacy clients and Shortcuts can refresh only their current day total; use the native app for full week/month reads.

Only the latest aggregate per member/group/period is replaced; previous days’ raw samples and daily totals are not written. Legacy `/steps` and `/shortcut/steps` uploads now replace the current day snapshot for active groups, without creating `step_days` rows. Old daily uploads remain readable for historical dates only, never as a fallback for the current week/month. A new period starts at midnight IST (Monday for weeks, the first for months). There is no requirement to open Stride before a cutoff to recover a complete week/month. Daily rewards are paused; existing balances are preserved.

Health providers must contain the requested history and source data. Android now requests read-only history permission as well as steps; ranges longer than 30 days require history access instead of publishing a potentially partial total. Rebuild the Android native app to include the manifest permission and permission-result fix. The installed react-native-health-connect bridge omits history grants from its results, so an idempotent postinstall patch exposes that existing grant without adding a dependency; it fails if the expected upstream code changes. Health Connect history restrictions and Apple Health permissions require physical-device validation; a provider may return less history than its own app displays. Health Connect/Apple Health totals can differ from a vendor app using different sources or deduplication. iOS does not expose read-denial status to the app. Native health access is required for automatic refresh; Safari cannot read HealthKit directly.

## Verify on devices

1. Install on one Android phone and one iPhone, create separate accounts, and grant read access.
2. Add recorded steps to Health Connect / Apple Health, tap **Connect health & refresh steps**, and confirm matching totals and ranks.
3. Deny Android permission and verify an error. On iOS, verify the platform’s unreadable-data behavior (HealthKit conceals read denial and can return no samples).
4. Disconnect a phone and verify no upload; reconnect and refresh the full selected period.
5. Skip a day, reopen the native app, and compare Week/Month with the health provider. Verify no new daily upload/result/ledger records are written and the settlement CLI reports that rewards are paused.

The API and settlement tests run locally. Native builds, store signing, and physical HealthKit/Health Connect reads must be checked on actual devices.

## iPhone web pilot with Apple Shortcuts

Open the same HTTPS API address in Safari (for the current EC2 pilot, `https://65.1.182.82/`). Create an account or sign in to see the day, week, and month leaderboard. The board refreshes every minute while visible and when Safari comes back into focus.

Expand **Set up iPhone sync** on the page. Generate a dedicated upload token and follow the displayed Shortcuts steps. The token appears only once, expires after 45 days, and can be rotated or revoked. The Shortcut should send `POST /shortcut/steps` with `Authorization: Bearer <upload token>` and JSON `{ "steps": <number> }`; the backend assigns the current IST date and records the source as `healthkit`. An explicit `day` must be the current IST date; there is no grace period. The upload token cannot access the account or leaderboard endpoints.

Tap **Sync now** in Safari to run the Shortcut named **Stride Sync**. Set a personal Shortcuts **Time of Day** automation at 11:45 PM IST, daily, **Run Immediately**, with **Run Shortcut → Stride Sync** for automatic uploads. The daily run captures steps as of 11:45 PM; tap Sync now later to include the final minutes. iOS may delay or miss an automation when the phone is off or disconnected, so verify the first refresh. This Shortcut reads only Today; Safari cannot refresh full week/month data unless those ranges were fetched by the native app.

**Health sample caveat:** a Shortcuts sum of raw Health step samples may differ from Apple Health's displayed total, particularly when Apple Watch and iPhone samples overlap. Compare the first sync with Health and filter the Shortcut to one preferred source if needed. This pilot flow requires manual setup on each iPhone; a web page cannot grant Health access or install the Shortcut on its own.

The new SQLite tables are created automatically at startup. Before applying the group migration on EC2, back up the database with SQLite's backup API (which also handles WAL data):

```sh
sudo -u ubuntu python3 -c 'import sqlite3; source=sqlite3.connect("/var/lib/stride/stride.sqlite3"); dest=sqlite3.connect("/var/lib/stride/stride-before-groups.sqlite3"); source.backup(dest); dest.close(); source.close()'
cd /home/ubuntu/Stride
git pull
sudo systemctl restart stride
curl -f https://65.1.182.82/health
```

Nginx already proxies `/` to the API. Android users need the APK built from this revision to see the group switcher; their old APK can still view its first joined group through the compatibility default, but cannot create or select groups.
