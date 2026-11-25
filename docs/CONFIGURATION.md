# Configuration

Everything is set in `.env`. Copy `.env.example` to get started. After any change run `docker compose up -d`.

To get a Discord id, turn on Developer Mode in Discord (Settings, Advanced), then right click the server, channel, role or user and choose Copy ID.

## Required

| Setting | What it is |
|---|---|
| `HOST_IP` | LAN address of the machine running Docker. Not `127.0.0.1`. |
| `GATE_USERS` | Logins for the web page. `name:password` pairs separated by commas. No commas in passwords. |
| `GATE_SESSION_SECRET` | Any long random string. Generate with `openssl rand -hex 32`. Change it and everyone gets logged out. |
| `DISCORD_TOKEN` | User token of the throwaway account that streams. Not a bot token. |
| `GUILD_ID` | Your server id. |
| `VOICE_CHANNEL_ID` | The voice channel to stream in. |

## Stream and ports

| Setting | Default | What it is |
|---|---|---|
| `STREAM_PATH` | `live` | Name of the stream. It is part of every URL, so it must match the path in OBS. |
| `RTSP_PORT` | `8554` | RTSP out of MediaMTX. |
| `HLS_PORT` | `8888` | HLS out of MediaMTX. |
| `WEBRTC_PORT` | `8889` | WHIP in from OBS, and the low delay player. |
| `WEBRTC_UDP_PORT` | `8189` | WebRTC media. Same number inside and outside the container. |
| `GATE_PORT` | `8080` | The login page. |
| `SITE_NAME` | `Screenarr` | Heading on the login page. |

## Slash commands (bot)

| Setting | Default | What it is |
|---|---|---|
| `BOT_TOKEN` | empty | Token of a real bot application. Empty means no slash commands. |
| `BOT_CLEAR_GLOBAL_COMMANDS` | `0` | `1` wipes the bot's old global commands on startup. Use it once when reusing an old bot. |

## Chat commands

| Setting | Default | What it is |
|---|---|---|
| `COMMAND_CHANNEL_ID` | empty | Text channel the streaming account reads for `!` commands. Empty turns them off. |
| `COMMAND_PREFIX` | `!` | The prefix. |

## Who can use commands

| Setting | Default | What it is |
|---|---|---|
| `ALLOWED_USER_IDS` | empty | User ids, comma separated. |
| `ALLOWED_ROLE_IDS` | empty | Role ids, comma separated. |

Leave both empty and anyone can use the commands.

## Jellyfin

| Setting | Default | What it is |
|---|---|---|
| `JELLYFIN_URL` | empty | Address of your Jellyfin server. Empty means live only. |
| `JELLYFIN_API_KEY` | empty | From Jellyfin, Dashboard, API Keys. |
| `JELLYFIN_USER_ID` | empty | A Jellyfin user id. Most versions need it, and playlists always do. Searches only return what this user can see. |
| `IDLE_SHUFFLE` | `0` | `1` plays random movies and episodes whenever the live feed is down. |
| `IDLE_LIBRARY_ID` | empty | Limits `IDLE_SHUFFLE`, `/random` and plain `/shuffle` to one library or collection. |
| `SHUFFLE_LISTS` | empty | Named playlists for `/shuffle`, as `name:id` pairs. Example: `christmas:abc123,horror:def456`. |
| `IDLE_LIST` | empty | Name of one list to play whenever the live feed is down. Wins over `IDLE_SHUFFLE`. |

The id of a library, collection, playlist or user is in the address bar when you open it in Jellyfin.

## Seerr

| Setting | Default | What it is |
|---|---|---|
| `SEERR_URL` | empty | Address of Seerr, Overseerr or Jellyseerr. Empty means no `/request`. |
| `SEERR_API_KEY` | empty | From Seerr, Settings, General. |
| `REQUESTS_CHANNEL_ID` | empty | Text channel where the bot posts when a request arrives. Needs `BOT_TOKEN`. |

## Now playing status

| Setting | Default | What it is |
|---|---|---|
| `LIVE_TITLE` | `Live stream` | What the status calls the live feed. |
| `ACCOUNT_PRESENCE` | `0` | `1` shows a now playing card with a progress bar on the streaming account. |
| `ACCOUNT_PRESENCE_APP_ID` | empty | A Discord application id. Needed for poster art on that card. The bot's id works. |
| `NOW_PLAYING_CHANNEL_ID` | empty | Text channel where the bot keeps one now playing card with the poster. Needs `BOT_TOKEN`. |

The bot's own status ("Watching ...") is on whenever `BOT_TOKEN` is set.

## Video

| Setting | Default | What it is |
|---|---|---|
| `HEIGHT` | `720` | Output height. 720 is the ceiling for an account without Nitro. |
| `LIVE_FPS` | `30` | Frame rate for the live feed. Movies keep their own. |
| `BITRATE` | `4000` | Video bitrate in kbps. |
| `NO_TRANSCODE_LIVE` | `0` | `1` passes the OBS encode straight through. Lowest CPU. Needs B-frames 0 and 1 s keyframes in OBS. |
| `MINIMIZE_LATENCY` | `0` | `1` shaves about a second off the live feed. Can fail to start if OBS keyframes are far apart. |
