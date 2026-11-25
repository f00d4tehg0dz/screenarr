# Guide

Set it up one piece at a time. Each step works on its own, so stop wherever you have what you want.

1. [Live stream to Discord](#1-live-stream-to-discord)
2. [Slash commands](#2-slash-commands)
3. [Jellyfin library](#3-jellyfin-library)
4. [Playlists and what plays when you are offline](#4-playlists-and-what-plays-when-you-are-offline)
5. [Requests](#5-requests)
6. [Now playing status](#6-now-playing-status)
7. [The web page](#7-the-web-page)
8. [Day to day](#8-day-to-day)
9. [Troubleshooting](#9-troubleshooting)

Every setting mentioned here is described in [CONFIGURATION.md](CONFIGURATION.md).

## 1. Live stream to Discord

You need Docker with compose, and a second Discord account that is already a member of your server and allowed to join and stream in the voice channel.

```bash
git clone <this repo>
cd screenarr
cp .env.example .env
```

Fill in the required settings in `.env`:

```
HOST_IP=192.168.1.50
GATE_USERS=me:a-password
GATE_SESSION_SECRET=<output of: openssl rand -hex 32>
DISCORD_TOKEN=<user token of the throwaway account>
GUILD_ID=<server id>
VOICE_CHANNEL_ID=<voice channel id>
```

Start it:

```bash
docker compose up -d --build
docker compose logs -f streamer
```

The first build takes a few minutes. You should see `Logged in as ...` and `Joined the voice channel`.

Now OBS. Settings, Stream:

- Service: `WHIP`. Not Custom, and not the auto configuration wizard, which only knows RTMP.
- Server: `http://HOST_IP:8889/live/whip`
- Bearer Token: empty

Settings, Output, Streaming:

- Encoder: your hardware H.264 encoder
- Rate control: CBR, 6000 to 8000 kbps
- Keyframe interval: 1 s
- B-frames: 0

Start streaming. The log says `Showing the live feed.` and the account goes live in the voice channel.

Set the keyframe interval. Leave it on auto and the streamer can join mid stream, never see a keyframe in time, and quit with an unhelpful ffmpeg error.

Capturing a console? Turn off HDCP on the console or OBS gets a black frame.

## 2. Slash commands

Slash commands need a real bot. The bot only handles commands. The video still goes out through the user account.

1. Create an application in the Discord developer portal and add a bot to it. Or reuse one you have.
2. Invite it to your server with the `bot` and `applications.commands` scopes.
3. Set `BOT_TOKEN` in `.env`.
4. `docker compose up -d`

The log says `Bot ... registered N slash commands`. They show up in your server right away.

Reusing an old bot? Its old commands will be listed next to the new ones. Set `BOT_CLEAR_GLOBAL_COMMANDS=1` for one start, then set it back to `0`.

No bot? Set `COMMAND_CHANNEL_ID` and type `!` commands in that channel. See [COMMANDS.md](COMMANDS.md).

## 3. Jellyfin library

```
JELLYFIN_URL=http://192.168.1.50:8096
JELLYFIN_API_KEY=<from Jellyfin: Dashboard, API Keys>
JELLYFIN_USER_ID=<a Jellyfin user id>
```

For the user id, open Dashboard, Users, click a user, and copy the long string after `userId=` in the address bar. Pick a user who can see the libraries you want to offer. Nothing outside that user's access will show up.

Restart with `docker compose up -d`. `/play`, `/random`, `/shuffle`, `/search` and `/seek` now work.

The Jellyfin server does not need to be reachable from the internet. The streamer talks to it over your LAN.

## 4. Playlists and what plays when you are offline

By default nothing plays when OBS is off. There are two ways to change that.

**Shuffle the whole library:**

```
IDLE_SHUFFLE=1
```

Random movies and episodes play back to back whenever the live feed is down. To keep it to one library or collection, set `IDLE_LIBRARY_ID` to its id.

**Shuffle one playlist:**

Make a playlist in Jellyfin, open it, and copy the `id` from the address bar. Give it a short name:

```
SHUFFLE_LISTS=christmas:abc123
IDLE_LIST=christmas
```

- `SHUFFLE_LISTS` adds a `list` option to `/shuffle`. You can name several: `christmas:abc123,horror:def456`.
- `IDLE_LIST` makes one of them the default whenever the live feed is down. Remove the line when the season is over.

A list plays in a fresh random order each pass, and nothing repeats until everything has played once. Change the playlist in Jellyfin and it is picked up within half an hour. No restart needed.

**What wins when:**

| Situation | On screen |
|---|---|
| OBS is streaming | The live feed |
| OBS is off | `IDLE_LIST`, else `IDLE_SHUFFLE`, else nothing |
| OBS starts | The live feed takes over, even mid movie |
| Someone uses `/play` | That title. When it ends, back to the rows above. |
| Someone uses `/shuffle` | Movies back to back until `/stop`, `/live`, or OBS starts |

One exception. If the live feed is already on and someone picks a movie anyway, the movie stays. `/live` brings the stream back.

## 5. Requests

If you run Seerr, Overseerr or Jellyseerr, people can ask for things that are not in the library yet.

```
SEERR_URL=http://192.168.1.50:5055
SEERR_API_KEY=<from Seerr: Settings, General>
REQUESTS_CHANNEL_ID=<text channel id>
```

`/request` appears. It suggests movies and shows as you type. If the title is already in the library, or already requested, it says so and does nothing.

With `REQUESTS_CHANNEL_ID` set, the bot posts in that channel when a request lands in the library, with the poster, and pings whoever asked. It checks once a minute. It announces everything Seerr finishes, including requests made on the Seerr site.

Know this before you hand it out:

- Requests go in with your API key, which is an admin key. They are approved on the spot and per user limits do not apply. Limit who can use `/request` in Server Settings, Integrations.
- The ping only works for requests made since the streamer last started. After a restart the post still happens, without the name.

## 6. Now playing status

With a bot, its status reads "Watching" plus the title. Nothing to set up. Use `LIVE_TITLE` to name the live feed.

For more:

```
NOW_PLAYING_CHANNEL_ID=<text channel id>
ACCOUNT_PRESENCE=1
ACCOUNT_PRESENCE_APP_ID=<the bot's application id>
```

- `NOW_PLAYING_CHANNEL_ID` makes the bot keep one card in that channel with the title, poster, start and end time. It edits the same message, so the channel does not fill up. The bot needs Send Messages and Embed Links there.
- `ACCOUNT_PRESENCE` puts a card with a progress bar on the streaming account. With an application id it also shows the poster.

Bots cannot put a picture in their own status. That is why the bot's poster lives in a channel card.

Posters come from the public address Jellyfin originally fetched them from. Discord cannot load images off a server on your LAN, but it can load those. A title Jellyfin never matched goes out with no art.

## 7. The web page

The same live stream is on a web page for people who are not on Discord.

| Where | URL | Delay |
|---|---|---|
| On your LAN, no login | `http://HOST_IP:8889/live` | under a second |
| Through the login page | `http://HOST_IP:8080` | 2 to 4 seconds |

Logins come from `GATE_USERS`. Sign out at `/logout`. Sessions last a week.

To put it on the internet, point your reverse proxy or tunnel at the gate port and nothing else. If the outside world can reach the MediaMTX ports directly, the login page is decoration.

The web page shows the live stream only. Library movies go to Discord, not the page.

Every web viewer pulls the full OBS bitrate from your upload. At 6 Mbps, ten viewers is 60 Mbps of upload. People watching in Discord cost you nothing extra.

## 8. Day to day

Run these from the `screenarr` folder.

| Task | Command |
|---|---|
| See what is running | `docker compose ps` |
| Follow the streamer log | `docker compose logs -f streamer` |
| Apply a `.env` change | `docker compose up -d` |
| Update | `git pull && docker compose up -d --build` |
| Restart the streamer | `docker compose restart streamer` |
| Stop everything | `docker compose down` |

## 9. Troubleshooting

**OBS says "Failed to connect to server".** Wrong IP, wrong port, or the service is still set to Custom. Open `http://HOST_IP:8889/live` in a browser. If that does not load either, it is not OBS.

**OBS connects, then drops.** The WebRTC UDP port is not getting through. It has to be the same number inside and outside the container, and `HOST_IP` has to be an address OBS can reach.

**The log sits at "Live feed is down. Waiting for it."** MediaMTX has no stream on that path. `STREAM_PATH` has to match the path in the OBS server URL. If OBS sends to `/game/whip`, set `STREAM_PATH=game`.

**ffmpeg exits with code 234 right after going live.** Keyframe interval. Set it to 1 s in OBS and restart the stream.

**"Jellyfin answered 400".** Set `JELLYFIN_USER_ID`.

**A playlist plays nothing.** The playlist is private to a different Jellyfin user. Share it with the user in `JELLYFIN_USER_ID`.

**Slash commands do not show up.** The bot was invited without the `applications.commands` scope. Invite it again with that scope.

**Old commands sit next to the new ones.** Set `BOT_CLEAR_GLOBAL_COMMANDS=1` for one start.

**Two bots answer.** Something else is still running with the same bot token. Stop it.

**"Seerr answered 401" or 403.** Wrong API key.

**No poster on the status.** Either Jellyfin has no match for that title, or `ACCOUNT_PRESENCE_APP_ID` is empty.

**It worked yesterday.** The Discord library probably updated, or Discord changed something. `streamer/package.json` tracks `latest`. Once you have a version that works, pin it.
