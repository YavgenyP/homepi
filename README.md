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

#### Registering a SmartThings appliance (TV, lights, etc.)

Smart appliances are registered directly in the database — not via Discord — because they need a SmartThings UUID rather than a human name.

See the full [Samsung SmartThings setup](#samsung-smartthings-setup-optional) section to get your token and device UUIDs, then register in the REPL:

```bash
docker exec -it homepi-homepi-1 npm run repl
```

```
sql INSERT INTO smart_devices (name, smartthings_device_id) VALUES ('tv', 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
```

After registration, control it from Discord:
```
turn on the TV
turn on the TV at 8pm
when I get home, turn on the lights
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
| Redirect URIs | `http://localhost:4567/callback` |
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

This is a one-time flow. The app opens a browser window for you to approve access,
then stores the tokens in SQLite. **You never need to repeat this.**

**If the Pi is remote (most common case):**

In a **separate terminal on your local machine**, open an SSH tunnel so your browser can reach port 4567 on the Pi:

```bash
ssh -L 4567:localhost:4567 youruser@homepi.local
# Keep this terminal open during the next step
```

**In your main terminal (SSH'd into the Pi)**, run the setup script inside the container:

```bash
docker exec -it homepi-homepi-1 npm run smartthings-setup
```

The script prints a URL like:
```
Open this URL in your browser:

https://api.smartthings.com/oauth/authorize?response_type=code&client_id=...

Waiting for callback on http://localhost:4567/callback ...
```

Open that URL in your browser on your local machine. SmartThings will ask you to sign in
and approve access. After you click **Authorise**, it redirects to `localhost:4567/callback`.
The terminal will print:

```
Done. Token stored. Expires at 2026-03-03T13:27:00.000Z.
```

You can now close the SSH tunnel terminal.

**If the Pi is local (same network, browser on the Pi):**

No tunnel needed — just run:
```bash
docker exec -it homepi-homepi-1 npm run smartthings-setup
```
and open the URL directly on the Pi.

**Troubleshooting:**
- `Missing required environment variable` → check `SMARTTHINGS_CLIENT_ID`/`SECRET` are in `.env` and the container was restarted
- `Token exchange failed: 401` → redirect URI in Developer Workspace doesn't match `http://localhost:4567/callback` exactly
- Browser shows "This site can't be reached" → SSH tunnel isn't running, or the setup script isn't waiting (check the terminal)
- Ran setup but tokens expired → re-run `npm run smartthings-setup`; the new tokens overwrite the old ones

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
