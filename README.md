# homepi

A local-first home automation control plane for Raspberry Pi.
Discord is the only user interface. You talk to the bot; it controls your home.

---

## How it works

1. You send a natural language message in Discord ("remind me at 8am to take out trash")
2. The bot parses your intent using OpenAI (returns strict JSON — no business logic in the LLM)
3. The intent is validated, then dispatched to the appropriate handler (rules, presence, etc.)
4. State lives entirely in SQLite. The system is fully recoverable from the database alone.

---

## What you can say

The bot understands natural language in any language. Here are the main flows (Discord or touchscreen chat):

**Presence**
```
register my phone 192.168.1.42          → start tracking your presence by IP ping
register my ble AA:BB:CC:DD:EE:FF       → presence via Bluetooth (Pi only)
who's home?                             → current presence state for all people
```

**Device control (immediate)**
```
turn on the ac
turn off the purifier
set the ac to 22 degrees
set ac to cool mode / heat / dry / auto
set ac fan to high / low / medium / auto
set purifier mode to auto / sleep
lock the purifier
mute the TV
set TV volume to 30
switch to HDMI2
open Netflix on TV
launch com.your.tvapp on the sei box   → launch Android app by package name
send HOME to the sei box               → send a remote key (HOME, BACK, DPAD_UP, …)
what apps does the sei box have?       → list all installed apps with package names
```

**Device control (scheduled)**
```
turn on the ac at 8pm
turn off the purifier at 11pm every day
when I get home, turn on the lights
```

**Device discovery and aliases**
```
sync my devices                         → pull all devices from Home Assistant
browse devices                          → see unregistered HA devices grouped by domain
show climate devices                    → browse only climate entities
add 1, 3                                → register devices by number from browse list
list my devices                         → show all registered devices + aliases
call the tadiran ac "ac"                → add an alias so you can just say "ac"
the AC is in the bedroom                → tag a device with a room label
set room of tv box to living room       → same, explicit form
```

**Sensors / queries**
```
what's the air quality?
what's the filter level?
is the ac on?
what's the ac temperature?             → returns: "ac: heat, current 22.5°, target 24°, fan: auto"
```

**Voice control (if enabled)**
```
[speak into Discord voice channel]     → bot transcribes via Whisper → same intent pipeline
[speak into Pi microphone]             → same flow, attributed to VOICE_MIC_USERNAME
```

**Sound / volume**
```
set volume to 50                        → set speaker volume (0–100)
stop music                              → kill active playback (ffplay / yt-dlp)
save shortcut lofi https://...          → store a sound shortcut by name
delete shortcut lofi                    → remove a sound shortcut
```

**Rules**
```
remind me tomorrow at 9am to call the dentist
remind Alice to take medicine every day at 8am
when I get home, tell me the weather
list my rules
delete rule 3
```

**Conversation memory**
The bot remembers the last 5 exchanges (up to 2 hours). If it asks a clarifying question, your follow-up has full context:
```
you: is the purifier on?
bot: Which device do you mean?
you: the one in the bedroom       ← bot understands this refers to the purifier
```

**Proactive suggestions**
If you manually control the same device at the same time of day 3+ times, the bot will proactively suggest scheduling it ~12 hours before the next expected run:
```
bot: You usually turn on the ac around 9pm. Want to schedule it?
     Reply with: "create rule: turn on ac at 9pm every day"
```

---

## Environment variables

All configuration is done via environment variables (`.env` file, or your shell environment).

### Required

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Your Discord bot token. Get it from the [Developer Portal](https://discord.com/developers/applications). |
| `DISCORD_CHANNEL_ID` | ID of the Discord channel the bot listens and replies in. Right-click the channel → Copy Channel ID. |
| `OPENAI_API_KEY` | OpenAI API key for intent parsing. |

### Optional (defaults shown)

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_MODEL` | `gpt-4o` | OpenAI model used for intent parsing. |
| `LLM_CONFIDENCE_THRESHOLD` | `0.75` | If the model's confidence is below this, the bot asks a clarifying question instead of acting. |
| `LLM_EVAL_SAMPLING_RATE` | `0.05` | Fraction of messages logged to `llm_message_log` for offline eval review (0 = disabled, 1 = all). |
| `SQLITE_PATH` | `./app.db` | Path to the SQLite database file. Inside Docker the volume mounts at `/data`, so use `/data/app.db`. |
| `PRESENCE_PING_INTERVAL_SEC` | `30` | How often to ping all registered devices (seconds). |
| `PRESENCE_PING_TIMEOUT_MS` | `1000` | Ping timeout per device (milliseconds). |
| `PRESENCE_HOME_TTL_SEC` | `180` | How long since last sighting before a person is marked "away". |
| `PRESENCE_DEBOUNCE_SEC` | `60` | Minimum time between home↔away state transitions (prevents flapping). |
| `PRESENCE_BLE_ENABLED` | `false` | Enable BLE scanning via bluetoothctl (Raspberry Pi only — see BLE section). |
| `PRESENCE_BLE_SCAN_INTERVAL_SEC` | `20` | Duration of each BLE scan window (seconds). |
| `SCHEDULER_INTERVAL_SEC` | `30` | How often the scheduler checks for due jobs (seconds). |
| `TTS_ENABLED` | `false` | Enable text-to-speech via OpenAI TTS API. Requires `ffmpeg` and `/dev/snd` access in Docker (see TTS section). |
| `TTS_VOICE` | `alloy` | OpenAI TTS voice. Options: `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`. |
| `PORT` | `3000` | Port for the `/health` HTTP endpoint (used by Docker healthcheck). |
| `HOMEASSISTANT_URL` | — | Base URL of your Home Assistant instance, e.g. `http://192.168.1.x:8123`. Both this and `HOMEASSISTANT_TOKEN` must be set to enable HA device control. |
| `HOMEASSISTANT_TOKEN` | — | Long-lived access token for HA (HA profile → Security → Long-lived access tokens). |
| `DISCORD_VOICE_CHANNEL_ID` | — | Voice channel ID to auto-join on startup for voice control. Both this and `DISCORD_GUILD_ID` must be set to enable Discord voice. |
| `DISCORD_GUILD_ID` | — | Guild (server) ID — required when `DISCORD_VOICE_CHANNEL_ID` is set. |
| `VOICE_MIC_ENABLED` | `false` | Enable Pi microphone input via `arecord` (requires `alsa-utils` on the host). |
| `VOICE_MIC_USER_ID` | `0` | Discord user ID to attribute Pi microphone commands to (for conversation history). |
| `VOICE_MIC_USERNAME` | `voice` | Display name used for Pi mic commands in history and context. |
| `VOICE_MIC_RECORD_SEC` | `5` | Duration of each microphone recording chunk in seconds. |
| `TOUCHSCREEN_ENABLED` | `false` | Enable the touchscreen web UI served on `:8080`. |
| `UI_PORT` | `8080` | Port for the touchscreen HTTP server. |
| `LOCAL_USER_ID` | — | Discord user ID to attribute touchscreen commands to. |
| `LOCAL_USERNAME` | — | Display name for touchscreen commands in conversation history. |
| `AUDIO_BACKEND` | `auto` | Audio backend for volume control: `auto`, `pulse` (PulseAudio), or `alsa` (amixer). |
| `WEATHER_API_KEY` | — | OpenWeatherMap API key. Required for the Weather screen on the touchscreen. |
| `WEATHER_LAT` | — | Latitude for weather queries (e.g. `32.08`). |
| `WEATHER_LON` | — | Longitude for weather queries (e.g. `34.78`). |
| `GDRIVE_PHOTOS_FOLDER_ID` | — | (Option B only) Google Drive folder ID to sync photos from (uses same service account key as GCal). |
| `PHOTOS_DIR` | `/data/photos` | Local directory where photos are stored and served from. |
| `PHOTO_SYNC_INTERVAL_MIN` | `60` | (Option B only) How often to re-sync photos from Google Drive (minutes). |

---

## Raspberry Pi 5 — Full Setup Guide

### What you need

- Raspberry Pi 5 (any RAM)
- MicroSD card (16 GB+) or SSD via USB
- A Discord bot token and a channel ID
- An OpenAI API key
- Your local network (router with DHCP reservations recommended)

---

### Step 1 — Flash and boot the Pi

1. Download **Raspberry Pi Imager** on your PC: https://www.raspberrypi.com/software/
2. Flash **Raspberry Pi OS Lite (64-bit)** — no desktop needed.
3. In the imager settings (gear icon) before flashing:
   - Set hostname (e.g. `homepi`)
   - Enable SSH
   - Set your username + password
   - Set your Wi-Fi credentials (if not using Ethernet)
4. Insert the SD card, boot the Pi, find its IP on your router's DHCP list.
5. SSH in:
   ```bash
   ssh youruser@homepi.local
   ```

---

### Step 2 — Set the correct timezone

The scheduler uses the Pi's local timezone for all time-based rules.

```bash
sudo raspi-config
# → Localisation Options → Timezone → select yours
```

Or directly:
```bash
sudo timedatectl set-timezone Asia/Jerusalem   # replace with your timezone
timedatectl   # verify
```

---

### Step 3 — Install Docker

The app runs inside Docker. Install it using the official convenience script:

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
```

Add your user to the docker group so you don't need `sudo`:
```bash
sudo usermod -aG docker $USER
newgrp docker
```

Verify:
```bash
docker --version
docker compose version
```

> Docker Compose is included with Docker on modern installs. If `docker compose` fails, install it:
> ```bash
> sudo apt install docker-compose-plugin
> ```

---

### Step 4 — Authenticate with the private Docker image registry

The prebuilt image lives at `ghcr.io/yavgenyp/homepi` (GitHub Container Registry) and is **private**.
You need a GitHub Personal Access Token (PAT) with `read:packages` scope to pull it.

1. Go to https://github.com/settings/tokens → **Generate new token (classic)**
2. Select scope: **`read:packages`**
3. Copy the token, then on the Pi:

```bash
echo YOUR_PAT | docker login ghcr.io -u YavgenyP --password-stdin
```

You should see `Login Succeeded`. Docker stores the credentials in `~/.docker/config.json` — you only need to do this once.

---

### Step 5 — Clone the repo

```bash
git clone https://github.com/YavgenyP/homepi.git
cd homepi
```

---

### Step 6 — Configure environment

Copy the example env file and fill in your values:

```bash
cp .env.example .env
nano .env
```

Minimum required:

```env
DISCORD_TOKEN=your-bot-token-here
DISCORD_CHANNEL_ID=your-channel-id-here
OPENAI_API_KEY=sk-...
SQLITE_PATH=/data/app.db
```

See the [Environment variables](#environment-variables) table above for all options.

---

### Step 7 — (Optional) Reserve a static IP for your Pi

On your router, create a DHCP reservation for the Pi's MAC address.
This ensures the Pi always gets the same IP, which matters if you ping it from another device.

---

### Step 8 — Pull and start

```bash
docker compose pull          # pulls ghcr.io/yavgenyp/homepi:latest
docker compose up -d         # starts in the background
```

This will:
- Pull the prebuilt ARM64 image (no compilation on the Pi)
- Run database migrations automatically on first start
- Start the Discord bot (you'll see "Bot online." posted in your Discord channel)
- Expose the health endpoint on port 3000

Check it's running:
```bash
curl http://localhost:3000/health
# → {"status":"ok"}

docker compose logs -f
```

---

### Step 9 — Create your Discord bot

If you haven't already:

1. Go to https://discord.com/developers/applications
2. Create a new application → Bot → copy the token → paste into `.env`
3. Under **Privileged Gateway Intents**, enable:
   - **Server Members Intent**
   - **Message Content Intent**
4. Under **OAuth2 → URL Generator**, select scopes: `bot`
   Permissions: `Send Messages`, `Read Message History`
5. Copy the generated URL, open it in your browser, invite the bot to your server.
6. Right-click the channel you want the bot to use → Copy Channel ID → paste into `.env`

---

### Step 10 — Verify the demo script

Follow `docs/demo.md` to verify all features end-to-end:

```
# In Discord:
"register my phone 192.168.1.23"
"who's home?"
"tomorrow at 8am remind me to take out the trash"
"when I arrive home tell me welcome home"
```

---

### Step 11 — Pair phones and register appliances

Before the bot can track presence or control devices, it needs to know about them.

---

#### Registering a phone (ping / Wi-Fi)

The simplest method: the bot pings your phone's local IP address. No hardware changes needed — just your phone and your router.

**Prerequisites:**
- Your phone is on the same Wi-Fi as the Pi
- You know your phone's local IP (check under Wi-Fi settings, or reserve it on your router — see Step 7)

**In Discord:**
```
register my phone 192.168.1.42
```

The bot creates your person record and starts pinging that IP every 30 seconds. When the ping succeeds you're marked home; when it times out long enough you're marked away.

> **Tip:** Reserve a static IP for your phone on your router (DHCP reservation by MAC address) so the IP never changes.

---

#### Registering a phone (BLE — passive Bluetooth detection)

A more reliable alternative that works even when your phone's Wi-Fi is off. Requires one-time Bluetooth pairing on the Pi.

See the full [BLE presence setup](#ble-presence-optional-raspberry-pi-only) section for step-by-step instructions.

Once paired and the BLE provider is enabled, register the phone in Discord:
```
register my ble AA:BB:CC:DD:EE:FF
```

---

#### Registering a smart appliance

**Home Assistant devices** — auto-discovery is the easiest method. Once HA is configured (see [Home Assistant setup](#home-assistant-setup-optional)), just say in Discord:
```
sync my devices
```
The bot pulls all entities from HA and inserts them into the database, using their HA friendly names. It replies with a summary of what was added vs already known.

You can also add short **aliases** so you don't have to use the full HA name:
```
call the tadiran ac "ac"
call the xiaomi purifier "purifier"
```
The bot will match "ac", "purifier", or even fuzzy variations ("the air thing") to the right device automatically.

**SmartThings devices** (TV, lights, etc.) must be registered manually — see the [Samsung SmartThings setup](#samsung-smartthings-setup-optional) section for UUID lookup, then register via REPL:
```
sql INSERT INTO smart_devices (name, smartthings_device_id) VALUES ('tv', 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
```

After registration, control from Discord:
```
turn on the TV
turn on the ac at 8pm
when I get home, turn on the purifier
```

---

### Auto-start on boot

`restart: unless-stopped` is already set in `docker-compose.yml`, so the container restarts automatically whenever Docker starts — including after a reboot or power cut.

Run these once to make sure everything is wired up:

```bash
# Ensure the Docker daemon starts on boot
sudo systemctl enable docker

# Verify it's active
sudo systemctl is-enabled docker   # should print: enabled
sudo systemctl is-active docker    # should print: active

# Confirm the container is set to restart
docker inspect homepi-homepi-1 --format '{{.HostConfig.RestartPolicy.Name}}'
# should print: unless-stopped
```

To test it end-to-end:
```bash
sudo reboot
# After the Pi comes back up (give it ~30 seconds):
docker compose -f ~/homepi/docker-compose.yml ps
# homepi-homepi-1 should show status: running
```

---

### Updating the app

When a new version is pushed to `main`, CI builds and pushes a new image automatically. To update the Pi:

```bash
cd homepi
git pull                                  # get the latest docker-compose.yml
docker compose up --pull always -d        # pull fresh image and restart
```

`--pull always` forces Docker to check the registry every time, never relying on a locally cached image. If the image digest hasn't changed, Docker skips the download and doesn't restart the container.

Migrations run automatically on startup — no manual DB changes needed.

#### Auto-update via cron (optional)

To have the Pi update itself automatically every night:

```bash
crontab -e
```

Add this line (adjust the path to where you cloned the repo):
```cron
0 3 * * * cd /home/youruser/homepi && git pull && docker compose up --pull always -d >> /var/log/homepi-update.log 2>&1
```

This runs at 3am daily. If no new image was pushed, Docker skips the download and nothing restarts.

---

### REPL — inspect and control live state over SSH

```bash
docker exec -it homepi-homepi-1 npm run repl
```

Available commands:

| Command | Description |
|---------|-------------|
| `status` | Current presence state for all people |
| `people` | All registered people and their devices |
| `rules` | All rules with trigger and action |
| `jobs` | Scheduled job queue |
| `enable <id>` | Enable a rule |
| `disable <id>` | Disable a rule |
| `delete <id>` | Delete a rule and its jobs |
| `sql <query>` | Run any SQL (SELECT, INSERT, UPDATE, DELETE, …) |
| `help` | Show all commands |
| `exit` | Quit |

---

### TTS — text-to-speech (optional, Raspberry Pi only)

When enabled, the bot speaks every response and notification aloud through the Pi's speakers via OpenAI TTS + ffplay.

In your `.env`:
```env
TTS_ENABLED=true
TTS_VOICE=alloy    # alloy | echo | fable | onyx | nova | shimmer
```

In `docker-compose.yml`, uncomment the TTS device block to give the container access to the Pi's ALSA sound system:
```yaml
devices:
  - /dev/snd:/dev/snd
group_add:
  - audio
```

`ffmpeg` (which includes `ffplay`) is already included in the Docker image.

---

### Voice control (optional)

Speak to the bot instead of typing. Two modes — both feed into the same intent pipeline as text messages.

---

#### Mode 1 — Discord voice channel

The bot auto-joins a configured voice channel on startup and listens per-user. When you stop speaking (1 second of silence), the audio is transcribed via OpenAI Whisper and processed as a normal command.

In your `.env`:
```env
DISCORD_VOICE_CHANNEL_ID=your-voice-channel-id
DISCORD_GUILD_ID=your-server-id
```

To get the voice channel ID: right-click the channel in Discord → Copy Channel ID (requires Developer Mode enabled in Discord settings).

**Discord bot permissions required** (add to OAuth2 URL Generator scopes):
- `Connect`, `Speak` (under Voice)

The bot joins silently (self-muted) — it listens but does not speak in the voice channel. Replies still go to the configured text channel (+ TTS if enabled).

---

#### Mode 2 — Pi microphone

Records 5-second chunks via `arecord` and sends to Whisper. Useful when you want to control the home by speaking near the Pi without picking up your phone.

Requires `alsa-utils` installed on the Pi host:
```bash
sudo apt install alsa-utils
```

In your `.env`:
```env
VOICE_MIC_ENABLED=true
VOICE_MIC_USER_ID=your-discord-user-id    # for conversation history attribution
VOICE_MIC_USERNAME=voice                   # display name in history
VOICE_MIC_RECORD_SEC=5                     # recording window (default 5)
```

You should see `Pi microphone voice control enabled.` in the container logs on startup.

> Short utterances (3 characters or fewer after transcription) are ignored to filter out background noise.

---

### Google Calendar sync (optional)

When enabled, every time-based rule you create via Discord also creates a matching Google Calendar event on the target person's calendar. If a person hasn't linked their calendar, the rule works normally (Discord notification only).

Auth uses a service account — one JSON key on the Pi, each person shares their calendar with the service account email. No OAuth flow, no token expiry.

#### Step 1 — Create a service account

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or select an existing one).
3. Enable the **Google Calendar API** for the project.
4. Go to **IAM & Admin → Service Accounts → Create Service Account**.
5. Give it a name (e.g. `homepi-gcal`), click **Done**.
6. Open the service account → **Keys** → **Add Key → Create new key → JSON**.
7. Download the JSON key file. Copy it to the Pi:
   ```bash
   scp homepi-gcal-key.json youruser@homepi.local:~/homepi/gcal-key.json
   ```

---

#### Step 2 — Update docker-compose.yml

Uncomment the GCal lines in `docker-compose.yml`:

```yaml
volumes:
  - homepi-data:/data
  - ./gcal-key.json:/data/gcal-key.json:ro

environment:
  GCAL_KEY_FILE: /data/gcal-key.json
```

Or set `GCAL_KEY_FILE=/data/gcal-key.json` in your `.env` file.

---

#### Step 3 — Share calendars with the service account

For each person who wants calendar sync:

1. Open **Google Calendar** on their phone or browser.
2. Go to **Settings → [their calendar name] → Share with specific people**.
3. Add the service account email (found in the JSON key file under `"client_email"`).
4. Grant permission: **Make changes to events**.
5. Save.

---

#### Step 4 — Set each person's calendar ID in the REPL

```bash
docker exec -it homepi-homepi-1 npm run repl
```

Then use the `sql` command to update the record:
```
sql UPDATE people SET gcal_calendar_id = 'alice@gmail.com' WHERE discord_user_id = '123456789';
```

The calendar ID is usually the person's Google email address. You can confirm it under **Google Calendar → Settings → [calendar name] → Calendar ID**.

---

#### Step 5 — Test it

Create a time-based rule via Discord:
```
remind me tomorrow at 9am to call the dentist
```

The event should appear in the linked Google Calendar within a few seconds.

---

### Samsung SmartThings setup (optional)

Control Samsung appliances (TV, lights, etc.) via Discord using the SmartThings REST API.
Authentication uses OAuth 2.0 with automatic token refresh — you authorise once and tokens are
silently refreshed forever. No Personal Access Tokens, no 24-hour expiry.

---

**Step 1 — Create an OAuth app using the SmartThings CLI (run on your local machine)**

The SmartThings web portal no longer has an app creation UI. You register the app via
the official CLI — **run this on your local machine (laptop/desktop), not on the Pi.**
The CLI needs to open a browser to log into your Samsung account, which doesn't work on a
headless Pi.

*Install the CLI on your local machine:*

```bash
# macOS
brew install smartthingscommunity/smartthings/smartthings

# Windows — download and run the .msi installer from:
# https://github.com/SmartThingsCommunity/smartthings-cli/releases

# Linux desktop / any platform via npm
npm install -g @smartthings/cli
```

*Create the app:*

```bash
smartthings apps:create
```

The CLI will open a browser tab — log in with your Samsung account.
Then fill in the interactive prompts:

| Prompt | What to enter |
|--------|---------------|
| Display name | `homepi` (or anything you like) |
| Description | `homepi device control` |
| Icon URL | leave blank (press Enter) |
| Target URL | leave blank (press Enter) |
| Redirect URIs | `https://example.com/callback` |
| Scopes | select `r:devices:*` and `x:devices:*` |

When finished, the CLI prints your **Client ID** and **Client Secret**.
**Copy them now — the secret is shown only once.**

> If you ever need to regenerate credentials:
> ```bash
> smartthings apps:oauth:generate <app-id>
> # find your app-id with: smartthings apps
> ```
> After regenerating you'll need to re-run `npm run smartthings-setup` on the Pi.

---

**Step 2 — Add credentials to `.env`**

Open your `.env` file on the Pi and add:

```env
SMARTTHINGS_CLIENT_ID=your-client-id-here
SMARTTHINGS_CLIENT_SECRET=your-client-secret-here
```

Then restart the container so it picks up the new variables:

```bash
docker compose up -d
```

---

**Step 3 — Find your device UUIDs**

SmartThings identifies devices by UUID, not by name. To list all devices on your account,
generate a **temporary** Personal Access Token at https://account.smartthings.com/tokens
(any scope, you can delete it afterwards), then run:

```bash
curl -s -H "Authorization: Bearer YOUR_TEMP_PAT" \
  https://api.smartthings.com/v1/devices \
  | jq '.items[] | {label, deviceId}'
```

Example output:
```json
{ "label": "Living Room TV", "deviceId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }
{ "label": "Kitchen Lights",  "deviceId": "11111111-2222-3333-4444-555555555555" }
```

If `jq` is not installed, use Python instead:
```bash
curl -s -H "Authorization: Bearer YOUR_TEMP_PAT" \
  https://api.smartthings.com/v1/devices \
  | python3 -c "import sys,json; [print(d['label'], d['deviceId']) for d in json.load(sys.stdin)['items']]"
```

Write down the `deviceId` UUID for each appliance you want to control.

---

**Step 4 — Register devices in the REPL**

Open the REPL inside the running container:

```bash
docker exec -it homepi-homepi-1 npm run repl
```

Use the `sql` command to register each device with the human-friendly name the bot will recognise:

```
sql INSERT INTO smart_devices (name, smartthings_device_id) VALUES ('tv', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
sql INSERT INTO smart_devices (name, smartthings_device_id) VALUES ('lights', '11111111-2222-3333-4444-555555555555');
```

The `name` column is what the LLM matches against — keep it short and lowercase
(`tv`, `lights`, `ac`, `fan`, etc.).

Verify the devices were saved:
```
sql SELECT * FROM smart_devices;
```

---

**Step 5 — Run the one-time OAuth setup**

This is a one-time flow. You approve access in your browser, paste one URL back into the
terminal, and tokens are stored in SQLite forever. **You never need to repeat this.**

Run the setup script inside the container (no SSH tunnel needed):

```bash
docker exec -it homepi-homepi-1 npm run smartthings-setup
```

The script prints a URL and waits:
```
=== SmartThings OAuth Setup ===

1. Open this URL in your browser:

   https://api.smartthings.com/oauth/authorize?...

2. Log in with your Samsung account and approve access.

3. You will be redirected to example.com — the page won't load, that's fine.
   Copy the full URL from your browser's address bar.

Paste the full redirect URL here:
```

Open the URL in your browser, log in, approve access.
You'll land on an example.com page that doesn't load — **that's expected**.
Copy the full URL from the address bar (it looks like `https://example.com/callback?code=XXXX...`),
paste it back into the terminal, and press Enter.

The terminal will print:
```
Done. Token stored. Expires at 2026-03-03T13:27:00.000Z.
```

**Troubleshooting:**
- `Missing required environment variable` → check `SMARTTHINGS_CLIENT_ID`/`SECRET` are in `.env` and the container was restarted (`docker compose up -d`)
- `Token exchange failed: 400/401` → redirect URI registered in the app doesn't match `https://example.com/callback` exactly — check with `smartthings apps:oauth <app-id>`
- `Could not parse the URL` → make sure you copied the full URL from the address bar, not just the code
- Tokens expired later → re-run `npm run smartthings-setup`; new tokens overwrite the old ones

---

**Step 6 — Control devices via Discord**

Once setup is complete, control devices naturally:

- Immediate: `turn on the TV`
- Time rule: `turn on the TV at 8pm`
- Arrival rule: `when I get home, turn on the lights`
- Turn off: `turn off the lights`

**How token refresh works:**
The app checks token expiry before every device command. If the token expires within 5 minutes,
it silently fetches a new one using the stored refresh token and updates SQLite.
No restarts, no manual steps — it runs forever.

---

### Home Assistant setup (optional)

Control devices that don't have a SmartThings integration (e.g. Tadiran AC via Tuya, Xiaomi air purifier via Mi Home) through Home Assistant's local REST API. HA and SmartThings coexist as parallel backends — the TV stays on SmartThings, other devices go through HA.

---

**Step 1 — Run Home Assistant in Docker**

Uncomment the `homeassistant` service block (and the `ha-config` volume) in `docker-compose.yml`, set the correct timezone, then:

```bash
docker compose up -d
```

HA will be accessible at `http://<pi-ip>:8123` once it starts. Complete the onboarding wizard on first launch.

> **Note:** The HA service uses `network_mode: host`. For homepi to share the same compose file you'll need to switch it to `network_mode: host` too (remove the `ports:` block and follow the BLE section instructions). Alternatively, run HA in a separate compose file on the same machine.

---

**Step 2 — Install the Xiaomi Miot custom component**

The built-in Xiaomi Miio integration has limited device support. [hass-xiaomi-miot](https://github.com/al-one/hass-xiaomi-miot) covers a much wider range of Mi Home devices including air purifiers.

Run this while HA is running (it writes directly into the config volume). Replace `homepi_ha-config` with your actual volume name if different (check with `docker volume ls`):

```bash
docker run --rm -it -v homepi_ha-config:/config alpine sh -lc '
apk add --no-cache wget unzip &&
mkdir -p /config/custom_components &&
cd /tmp &&
wget -O xiaomi-miot.zip https://github.com/al-one/hass-xiaomi-miot/archive/refs/heads/master.zip &&
unzip -q xiaomi-miot.zip &&
rm -rf /config/custom_components/xiaomi_miot &&
cp -r hass-xiaomi-miot-master/custom_components/xiaomi_miot /config/custom_components/ &&
test -f /config/custom_components/xiaomi_miot/manifest.json && echo "OK: xiaomi_miot installed"
'
```

---

**Step 3 — Restart Home Assistant**

```bash
docker compose restart homeassistant
```

---

**Step 4 — Add your device integrations in the HA UI**

- **Tadiran AC (Tuya):** Settings → Integrations → Add → **Tuya** — follow the prompts to link your Tuya/Smart Life account.
- **Xiaomi air purifier:** Settings → Integrations → Add → **Xiaomi Miot** — complete the config flow (cloud login or local IP/token).

Once integrated, your devices will appear in HA with entity IDs like `climate.tadiran_ac` or `fan.xiaomi_purifier`.

---

**Step 5 — Find entity IDs**

In HA: **Developer Tools → States** tab. Filter by device name to find the full entity ID (e.g. `climate.tadiran_ac`).

---

**Step 6 — Generate a long-lived access token**

In HA: click your profile icon (bottom-left) → **Security** tab → scroll to **Long-lived access tokens** → **Create Token**.
Give it a name (`homepi`) and copy the token — it is shown only once.

---

**Step 7 — Add env vars to `.env`**

```env
HOMEASSISTANT_URL=http://192.168.1.x:8123
HOMEASSISTANT_TOKEN=your-long-lived-token-here
```

Then restart the container:
```bash
docker compose up -d
```

You should see `Home Assistant device control enabled.` in the logs.

---

**Step 8 — Register devices**

The easiest way is auto-discovery. In Discord:
```
sync my devices
```
The bot pulls all entities from HA and registers them using their friendly names. You'll get a reply like:
```
Added 12 devices:
  • tadiran ac → climate.tadiran_ac
  • xiaomi purifier → fan.xiaomi_purifier
  • air quality → sensor.xiaomi_cpa4_pm25
  ...
```

To add manually via REPL instead:
```bash
docker exec -it homepi-homepi-1 npm run repl
```
```
sql INSERT INTO ha_devices (name, entity_id) VALUES ('ac', 'climate.tadiran_ac');
```

---

**Step 9 — Add aliases (optional)**

HA friendly names are often long. Add short aliases in Discord:
```
call the tadiran ac "ac"
call the xiaomi purifier "purifier"
```

After that, both the original name and the alias work. The bot also uses **embedding similarity** — so even if you don't set an alias, saying "the air thing" or "cooling unit" will resolve to the closest registered device automatically.

To list all registered devices:
```
list my devices
```

---

**Step 10 — Control devices via Discord**

```
turn on the ac
turn off the purifier at 11pm
when I get home, turn on the ac
set the ac to 22 degrees
set ac to cool mode
set ac to heat
set ac fan to high
set ac fan speed to auto
set purifier mode to auto
set purifier to sleep mode
lock the purifier
unlock the purifier
what's the air quality?
what's the filter level?
```

**Supported commands:**

| What you say | Command sent to HA |
|---|---|
| "turn on/off the ac" | `homeassistant/turn_on\|off` |
| "set ac to 22 degrees" | `climate/set_temperature` `{ temperature: 22 }` |
| "set ac to cool / heat / dry / auto" | `climate/set_hvac_mode` `{ hvac_mode: "cool" }` |
| "set ac fan to high / low / auto" | `climate/set_fan_mode` `{ fan_mode: "high" }` |
| "what's the ac temperature?" | returns: `ac: heat, current 22.5°, target 24°, fan: auto` |
| "set purifier mode to sleep" | `fan/set_preset_mode` `{ preset_mode: "sleep" }` |
| "set volume to 40" | `media_player/volume_set` `{ volume_level: 0.4 }` |
| "launch com.pkg.name on the sei box" | `media_player/play_media` `{ media_content_type: "app", media_content_id: "com.pkg.name" }` |
| "send HOME to the sei box" | `remote/send_command` `{ command: "HOME" }` |

**Android TV Remote** — once the `androidtv_remote` integration is added in HA and the device registered in homepi, you can:
- Launch apps by package name: `launch com.yes.yesmax on the sei box`
- Send any remote key: `send HOME to sei box`, `send BACK to sei box`, `send DPAD_UP to sei box`
- To find installed app package names: `what apps does the sei box have` (check `app_list` in HA Developer Tools → States for the `media_player.*` entity)

**How device lookup works (3-tier):**
1. **Exact name match** — "ac" matches a device named "ac" instantly
2. **Alias match** — "ac" matches a device whose aliases include "ac"
3. **Embedding similarity** — "the cooling unit" or "air thing" is compared via `text-embedding-3-small` cosine similarity against all registered devices; the closest match above a confidence threshold is used

If nothing matches → "I don't know a device called…"

---

### BLE presence (optional, Raspberry Pi only)

BLE scanning detects whether a phone is home by passively picking up its Bluetooth advertisements.
No network, no IP, no DHCP needed — only Bluetooth.

#### The Android MAC randomization problem

Android phones randomize their BLE advertising MAC address by default (privacy feature since Android 10).
If you scan without pairing first, you'll see a different random MAC every time and detection will never work.

**The fix: pair each phone with the Pi first.** Once paired, the Pi holds the phone's Identity Resolving Key (IRK). BlueZ uses this to resolve the random advertising MAC back to the real, stable identity address on every scan. After pairing, detection is fully passive — the phone just needs Bluetooth on.

---

#### Step 1 — Install BlueZ on the Pi host

```bash
sudo apt install bluez
sudo systemctl enable bluetooth
sudo systemctl start bluetooth
```

---

#### Step 2 — Pair each Android phone with the Pi

Do this once per phone, **before** registering it in Discord.

On the Pi:
```bash
sudo bluetoothctl
```

Inside the bluetoothctl prompt:
```
power on
agent on
scan on
```

On the Android phone:
- Open **Settings → Connected devices → Pair new device**
- Make sure Bluetooth is on and the phone is in discoverable mode

Watch the Pi terminal — your phone will appear, e.g.:
```
[NEW] Device AA:BB:CC:DD:EE:FF Pixel 8
```

Still inside bluetoothctl, pair and trust it:
```
pair AA:BB:CC:DD:EE:FF
trust AA:BB:CC:DD:EE:FF
scan off
quit
```

Accept the pairing prompt on the phone when it appears.

Repeat for your second phone.

---

#### Step 3 — Find the stable MAC address for each phone

After pairing, list all known devices to get the stable identity address:

```bash
bluetoothctl devices
```

Example output:
```
Device AA:BB:CC:DD:EE:FF Pixel 8
Device 11:22:33:44:55:66 Galaxy S24
```

These are the stable MACs you'll register in Discord. Write them down.

---

#### Step 4 — Update docker-compose.yml

Open `docker-compose.yml` and replace the service block with:

```yaml
services:
  homepi:
    image: ghcr.io/yavgenyp/homepi:latest
    build: .
    restart: unless-stopped
    env_file: .env
    # ports removed — not compatible with network_mode: host
    network_mode: host
    volumes:
      - homepi-data:/data
      - /run/dbus:/run/dbus:ro
    cap_add:
      - NET_ADMIN
      - SYS_ADMIN
```

> Note: `network_mode: host` replaces the `ports:` mapping. The health endpoint is still reachable at `http://localhost:3000/health` from the Pi itself.

---

#### Step 5 — Update .env

```env
PRESENCE_BLE_ENABLED=true
PRESENCE_BLE_SCAN_INTERVAL_SEC=20
```

---

#### Step 6 — Restart the container

```bash
docker compose up -d
```

---

#### Step 7 — Register each phone in Discord

```
register my ble AA:BB:CC:DD:EE:FF
register my ble 11:22:33:44:55:66
```

(Use the MACs from Step 3.)

---

#### How detection works day-to-day

- Phone Bluetooth just needs to be **on** (no discoverable mode, no active connection)
- The Pi scans every `PRESENCE_BLE_SCAN_INTERVAL_SEC` seconds and picks up BLE advertisements
- A person is marked **home** if their phone was seen within `PRESENCE_HOME_TTL_SEC` seconds
- Transitions are debounced by `PRESENCE_DEBOUNCE_SEC` to avoid flapping

If detection feels slow or unreliable, lower `PRESENCE_BLE_SCAN_INTERVAL_SEC` (e.g. `10`) and `PRESENCE_HOME_TTL_SEC` (e.g. `90`).

---

### Touchscreen UI (optional)

An optional Alpine.js web app served on port 8080 turns any attached display (or phone browser) into a local home control panel. Enable it with one env var — no separate install needed.

```env
TOUCHSCREEN_ENABLED=true
UI_PORT=8080
LOCAL_USER_ID=your-discord-user-id   # commands from the touchscreen are attributed to this user
LOCAL_USERNAME=touchscreen
```

Then restart the container:
```bash
docker compose up -d
```

Open `http://<pi-ip>:8080` in a browser. The UI has five screens (bottom nav tabs):

| Tab | Description |
|-----|-------------|
| **Home** | Clock/date, who's-home dots, 4 quick-action tiles from recent task history, live Discord message feed |
| **Devices** | Live device states from HA, grouped by room. Domain-aware widgets: climate (temp + mode), media player (vol, play/pause), fan, light (brightness), sensor (read-only), switch/SmartThings. Refreshes every 3 s. |
| **Media** | YouTube search (yt-dlp) with ▶ (Pi speakers) and 📺 (browser embed) per result. Now-playing bar for registered HA `media_player`, play/pause/stop/prev/next, volume slider, sound shortcut tiles. |
| **Weather** | Current temperature + icon, 3-day forecast tiles. Auto-refreshes every 10 min. Requires `WEATHER_API_KEY`, `WEATHER_LAT`, `WEATHER_LON`. |
| **Chat** | Message list with local/bot bubbles, text input, mic button (records via `arecord` + Whisper → same intent pipeline as Discord). |

After 5 minutes of inactivity the screen dims to a full-screen idle overlay showing the clock and a photo slideshow (see below).

---

#### Photo slideshow (idle overlay)

Each photo is shown for 5 seconds with a crossfade transition. There are two ways to feed photos into the slideshow:

---

**Option A — Google Photos via rclone (recommended)**

rclone can pull a random selection of N photos from your Google Photos library (or a specific album). It runs on the Pi host and drops files into the Docker volume — no Docker changes needed.

1. Install rclone on the Pi:
   ```bash
   sudo apt install rclone
   ```

2. Authenticate with Google Photos (one-time):
   ```bash
   rclone config
   # Choose "n" (new remote), name it e.g. "gphotos"
   # Choose "Google Photos", follow the OAuth browser flow
   ```

3. Create a sync script at `/usr/local/bin/homepi-photos-sync.sh`:
   ```bash
   #!/bin/bash
   DEST=/data/photos
   COUNT=${1:-50}          # number of random photos to keep

   mkdir -p "$DEST"
   rm -f "$DEST"/*.jpg "$DEST"/*.png

   rclone ls "gphotos:media/all" \
     | shuf | head -"$COUNT" \
     | awk '{print $2}' \
     | while read -r f; do
         rclone copy "gphotos:media/all/$f" "$DEST/" --no-traverse 2>/dev/null
       done

   echo "Synced $COUNT random photos to $DEST"
   ```
   ```bash
   chmod +x /usr/local/bin/homepi-photos-sync.sh
   ```

4. Run it once to verify, then add a daily cron (picks 50 random photos at 3am):
   ```bash
   /usr/local/bin/homepi-photos-sync.sh 50

   crontab -e
   # Add:
   0 3 * * * /usr/local/bin/homepi-photos-sync.sh 50
   ```

   To sync from a specific album instead of the whole library:
   ```bash
   rclone ls "gphotos:album/Family" | shuf | head -50 | ...
   ```

5. Set in `.env`:
   ```env
   PHOTOS_DIR=/data/photos
   ```

No `GDRIVE_PHOTOS_FOLDER_ID` needed for this option — the Docker container just serves whatever rclone drops in `/data/photos`.

---

**Option B — Google Drive folder (uses existing service account)**

Create a folder in Google Drive, upload your slideshow photos there, share the folder with the service account email (found in `gcal-key.json` under `"client_email"`), then:

```env
GDRIVE_PHOTOS_FOLDER_ID=your-folder-id   # from the Drive URL
PHOTOS_DIR=/data/photos                   # default
PHOTO_SYNC_INTERVAL_MIN=60               # re-sync frequency
```

The folder ID is the long string at the end of the Drive folder URL.

---

#### Weather screen

Requires a free [OpenWeatherMap](https://openweathermap.org/api) API key:

```env
WEATHER_API_KEY=your-owm-key
WEATHER_LAT=32.08
WEATHER_LON=34.78
```

Current conditions and a 3-day forecast are fetched on demand and cached for 1 hour.

---

#### Volume control and media shortcuts

Set the speaker volume or stop playback from Discord or the Media screen:

```
set volume to 50        → sets system volume via PulseAudio (pactl) or ALSA (amixer)
stop music              → kills all active ffplay / yt-dlp processes
```

Control which backend is used:
```env
AUDIO_BACKEND=auto    # tries pactl first, falls back to amixer
```

#### Setting the default audio output device

All volume and playback commands use the system default sink (`@DEFAULT_SINK@`). If you have multiple audio outputs (USB speakers, HDMI, Bluetooth), make sure the right one is default.

**Check available outputs:**
```bash
pactl list short sinks
# or:
aplay -l
```

**Set USB speakers as default:**
```bash
# Replace with the sink name from the list above
pactl set-default-sink alsa_output.usb-Generic_USB_Audio-00.analog-stereo

# Make it permanent across reboots:
echo "set-default-sink alsa_output.usb-Generic_USB_Audio-00.analog-stereo" \
  >> ~/.config/pulse/default.pa
```

**Or via raspi-config (simplest):**
```bash
sudo raspi-config   # → System Options → Audio → select your device
```

**Test it:**
```bash
speaker-test -t wav -c 2
# or:
aplay /usr/share/sounds/alsa/Front_Center.wav
```

> **Bluetooth:** when a BT device is connected it becomes the active sink automatically. When disconnected, the system falls back to whatever default is set above — no config changes needed.

Save sound shortcuts for quick playback from the Media screen:
```
save shortcut lofi https://...
delete shortcut lofi
```

Play a URL immediately (YouTube, radio stream, local file):
```
play https://www.youtube.com/watch?v=...
```

---

### YouTube player (touchscreen)

The Media tab has a YouTube search bar powered by `yt-dlp`. Each result has two buttons:

| Button | What it does |
|--------|--------------|
| **▶** | Plays audio on Pi speakers via `yt-dlp + ffplay` (background process) |
| **📺** | Opens the video in a full-screen YouTube embed overlay (browser audio) |

**Requirements:** `yt-dlp` and `ffmpeg` must be installed on the Pi (`apt install ffmpeg && pip install yt-dlp`).

#### Using your paid YouTube account (optional)

Both playback modes benefit from being logged into YouTube:
- **Browser / iframe**: simply log into YouTube in the Pi's Chromium browser. The embed player will use that session automatically.
- **yt-dlp**: requires a `cookies.txt` file exported from your browser.

**Export cookies (run once on the Pi after logging into YouTube in Chromium):**

> **Note:** `/data` is a Docker volume — it doesn't exist on the Pi host. Save cookies to your home directory and mount them separately.

```bash
mkdir -p ~/yt-cookies
yt-dlp --cookies-from-browser chromium --cookies ~/yt-cookies/cookies.txt \
  --skip-download "https://youtube.com" -o /dev/null
```

**Mount into the container** — add to `docker-compose.yml`:
```yaml
volumes:
  - homepi_data:/data
  - ~/yt-cookies/cookies.txt:/data/yt-cookies.txt:ro
```

**Set in `.env`:**
```env
YTDLP_COOKIES_FILE=/data/yt-cookies.txt
```

The cookies file is picked up automatically by all yt-dlp calls (search results playback, sound shortcuts, `play <url>` commands).

---

### Logs and debugging

```bash
docker compose logs -f            # live logs
docker compose ps                 # container status

# Shell inside the container:
docker exec -it homepi-homepi-1 sh

# Inspect the SQLite database directly (inside container):
sqlite3 /data/app.db
.tables
SELECT * FROM people;
SELECT * FROM rules;
```

---

## CI / Docker image

Every push to `main`:
1. Runs all tests (`npm test`)
2. Builds a multi-platform Docker image (`linux/amd64` + `linux/arm64`)
3. Pushes to `ghcr.io/yavgenyp/homepi:latest` and `ghcr.io/yavgenyp/homepi:sha-<commit>`

The image is **private**. After the first CI push, set the package visibility:
**GitHub → your profile → Packages → homepi → Package settings → Change visibility → Private**

Pull requests only run tests — no image is built or pushed.

---

## Development (local)

```bash
npm install
cp .env.example .env   # fill in values
npm run dev            # runs with tsx watch (no build step)
npm test               # run unit tests
npm run eval           # run evals (fixture mode, no API key needed)
EVAL_MODE=live npm run eval   # run evals against real OpenAI

# Build and run Docker locally (bypasses GHCR):
docker compose up --build
```

---

## Project docs

| File | Purpose |
|------|---------|
| `docs/anchor.md` | Project goal, constraints, v0 definition of done |
| `docs/backlog.md` | Ordered implementation backlog with status |
| `docs/architecture.md` | Module structure, DB schema, intent shape |
| `docs/demo.md` | Acceptance / demo script |
| `docs/env.md` | Environment variable reference |
| `docs/long-term-vision.md` | Architectural invariants and future integrations |
| `CLAUDE.md` | AI assistant contract (non-negotiables, workflow) |
