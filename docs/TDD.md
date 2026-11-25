# Technical design

How Screenarr is built and why.

## Goal

Put one screen in a Discord voice channel and keep something on it: a live stream from OBS when there is one, library content when there is not, and whatever people ask for in between. Offer the same live stream on a private web page.

## What it is not

- A media server. Jellyfin stays the library.
- A downloader. Seerr and whatever sits behind it do that.
- Multi channel. One voice channel, one screen.

## Architecture

```mermaid
flowchart LR
    OBS["OBS Studio"]
    JF[("Jellyfin")]
    SEERR[("Seerr")]

    subgraph HOST["Docker host"]
        MTX["MediaMTX<br/>media server"]
        GATE["Gate<br/>login page and proxy"]
        subgraph STR["Streamer"]
            PLAYER["Player<br/>decides what is on"]
            ACCOUNT["User account client<br/>sends video"]
            BOT["Bot client<br/>slash commands, status"]
        end
    end

    subgraph DISCORD["Discord"]
        VC["Voice channel"]
        TEXT["Text channels"]
    end

    WEB["Browser viewers"]

    OBS -- WHIP --> MTX
    MTX -- RTSP --> PLAYER
    MTX -- HLS --> GATE
    GATE -- HTTPS via your proxy --> WEB
    JF -- video files --> PLAYER
    PLAYER --> ACCOUNT
    ACCOUNT -- Go Live --> VC
    BOT -- commands and posts --- TEXT
    BOT --> PLAYER
    BOT -- search and request --- SEERR
    BOT -- search --- JF
```

Three containers, defined in `docker-compose.yml`.

| Container | Job |
|---|---|
| `mediamtx` | Takes one stream in from OBS and serves it as RTSP, HLS and WebRTC. Stock image, configured by environment variables. |
| `gate` | A login page in front of the HLS player. One Node file with no dependencies. Signed cookie sessions, login throttling. |
| `streamer` | Everything Discord. Holds two Discord clients and the player. |

Jellyfin and Seerr are outside the stack and optional.

## Why two Discord clients

Discord does not let bots send video, and does not let user accounts own slash commands. So the streamer runs both:

- A **user account client** joins the voice channel and sends video.
- A **bot client** owns the slash commands, the status and the channel posts.

Keeping commands on the bot means the user account does as little as possible besides stream. That account is the part that breaks Discord's rules, so the less it does the better.

Without a bot, the user account can read `!` commands in one channel instead.

## The player

The player holds one target and keeps the screen matching it.

| Target | Meaning |
|---|---|
| `auto` | The live feed if it is up. Otherwise the idle list, or idle shuffle, or nothing. |
| `item` | One specific library item someone asked for. More can wait behind it in the queue. |
| `shuffle` | Random picks back to back, from all movies or one list. |
| `idle` | Nothing. |

```mermaid
stateDiagram-v2
    [*] --> Auto
    Auto --> Item: play, random
    Auto --> Shuffle: shuffle
    Auto --> Idle: stop
    Item --> Item: ends or skipped, queue has more
    Item --> Auto: ends or skipped, queue empty
    Item --> Auto: live
    Item --> Shuffle: shuffle
    Item --> Idle: stop
    Shuffle --> Item: play, random
    Shuffle --> Auto: live
    Shuffle --> Idle: stop
    Idle --> Auto: live
    Idle --> Item: play, random
    Idle --> Shuffle: shuffle
    Item --> Auto: live feed comes up
    Shuffle --> Auto: live feed comes up
    Idle --> Auto: live feed comes up
```

Rules worth knowing:

- **Commands change the target and cancel what is playing.** The loop then resolves the new target. There is one loop and one playback at a time, so there are no races between commands.
- **Live wins on arrival.** A watcher probes the live path every few seconds. On the change from down to up it sets the target to `auto`, which cuts to the stream. It only fires on the change. If the stream was already up when someone picked a movie, the movie stays.
- **A finished item makes way for the next in the queue.** With nothing waiting it returns to `auto`, so the screen goes back to the stream or the idle content on its own.
- **Skip keeps the mode.** In shuffle it picks again. On a requested item it moves to the next in the queue.
- **The queue only exists while an item is the target.** A request made in any other mode plays at once, because nobody chose what it interrupts. Anything that takes the screen away (stop, live, shuffle, the live feed arriving) empties the queue. That keeps one rule instead of several: the queue is never sitting there with nothing draining it.

The player takes its dependencies as functions (`play`, `probeLive`, `pickIdle`, `pickShuffle`). It knows nothing about Discord, Jellyfin or ffmpeg, which is what makes it testable.

## Skipping

Skipping someone else's pick is a vote. The handler asks the user account client who is in the voice channel, keeps a set of voters for the item on screen, and skips once the votes pass `SKIP_VOTE_RATIO` of the people present. Strictly more than the ratio, so two people both have to agree.

- Votes are tied to the item and when it started. A new item or a seek starts a new count.
- Votes from people who have left the channel are dropped at count time.
- The person who picked it, and admins, skip outright. So does anyone when the thing on screen was not chosen by a person.
- If the voice channel cannot be read, skip works without a vote. Locking everyone out would be worse.

## Playback

- **Live:** the streamer pulls RTSP from MediaMTX over TCP and re-encodes to H.264 at the configured height, frame rate and bitrate. `NO_TRANSCODE_LIVE` passes the OBS encode through instead.
- **Library:** the streamer asks Jellyfin for the original file (`static=true`), so there is one encode, not two. Movies keep their own frame rate. Seeking restarts playback at an offset.
- The Jellyfin API key goes in a header, never in a URL, so it stays out of logs.

## Shuffle

Plain shuffle and idle shuffle ask Jellyfin for one random item each time.

A named list uses a shuffle bag: load the playlist, shuffle it, deal one at a time, reshuffle when empty. Every item plays once before any repeats, and a new pass never opens with the item that closed the last one. The bag reloads the playlist every 30 minutes and merges changes into the current pass, so edits in Jellyfin show up without a restart.

## Requests

```mermaid
sequenceDiagram
    participant U as User
    participant B as Bot
    participant S as Seerr
    participant C as Requests channel

    U->>B: /request (typing)
    B->>S: search
    S-->>B: matches
    B-->>U: suggestions
    U->>B: picks one
    alt already in library or already requested
        B-->>U: says so, does nothing
    else new
        B->>S: create request
        B-->>U: requested
    end
    loop every minute
        B->>S: what has finished?
        S-->>B: finished requests
    end
    B->>C: it is ready, with poster and a ping
```

The streamer keeps no file. On startup it reads what Seerr already lists as finished and treats it as old. Anything that appears later is announced once. Who asked for what is held in memory, so the ping does not survive a restart. The announcement does.

## Now playing

The player reports every change. One debounced handler turns the state into a small description (title, state, start, end, poster) and hands it to each target:

| Target | Shows |
|---|---|
| Bot status | "Watching" plus the title. Text only. Discord does not allow images here. |
| Channel card | One embed, edited in place: title, poster, start and end time. |
| User account status | Card with a progress bar, and the poster when an application id is set. |

Posters are the public URLs Jellyfin originally fetched its artwork from. Discord loads images itself and cannot reach a LAN address, so the local copy is no use. Episodes use their show's poster.

A status update that fails is logged once and dropped. It can never interrupt playback.

## Status

A small health object records when the process started and the last five errors, one line each. The player, the request poller and the command handlers all report into it.

`/status` builds its answer from that plus a live look around: the player's mode and queue, whether the live feed last probed up, a version call to Jellyfin and to Seerr with a four second limit each, the two Discord accounts, and the head count in the voice channel. A check that hangs counts as down, so the command always answers.

## The gate

- Sessions are a signed cookie (HMAC-SHA256 over user and expiry). No database.
- Passwords are compared in constant time.
- Eight failed logins per address per ten minutes, then a 429.
- Everything except `/login` and `/logout` needs a session. Page requests get a redirect, media requests get a 401.
- The session cookie is stripped before proxying, so it never reaches MediaMTX.

The gate proxies HLS only. The low delay WebRTC player is for the LAN, since WebRTC media does not pass through most tunnels.

## Security notes

- Only the gate port should be reachable from the internet.
- Jellyfin and Seerr are reached over the LAN.
- The Seerr key is an admin key. Requests through it skip approval and quotas. Limit `/request` with Discord's own permissions.
- Secrets live in `.env`, which is gitignored.
- The user account token gives full control of that account. Use a throwaway.

## Failure handling

| What fails | What happens |
|---|---|
| OBS stops | Playback ends, target stays `auto`, idle content starts or it waits. |
| Jellyfin is down | Logged once. Live still works. Retries on the next pass. |
| A file will not play | Logged, short pause, next pick or back to `auto`. |
| Seerr is down | Logged. Checked again next minute. |
| A status update fails | Logged once and skipped. |
| Anything above | Shows up under "Last errors" in `/status`. |
| The streamer crashes | Docker restarts it. It rejoins and resolves `auto`. The queue is gone. |

## Code layout

```
gate/server.js            login page and HLS proxy
streamer/src/
  index.js                wiring: clients, player, commands
  config.js               reads settings from the environment
  player.js               what is on screen, and the queue
  handlers.js             commands, as plain functions, including skip votes
  commands.js             parsing for chat commands and times
  slash.js                slash command definitions and interaction logic
  bot.js                  the bot client
  jellyfin.js             Jellyfin client
  seerr.js                Seerr client
  requests.js             request flow and arrival announcements
  bag.js                  shuffle bag
  presence.js             now playing status and card
  health.js               recent errors and the status report
streamer/test/run.js      tests
```

The split is deliberate. `index.js` and `bot.js` are the only files that touch Discord. Everything else takes plain objects and functions, so the tests can run it with fakes.

## Testing

`npm test` in `streamer/` runs plain Node tests with no framework. They cover command parsing, the player's transitions, the queue, skip votes, the shuffle bag, both API clients against local fake servers, the request flow, and the status output.

Not covered: the Discord connection, real Jellyfin and Seerr servers, and ffmpeg. Those are checked by running it.

## Known limits

- Depends on a library that reverse engineers Discord's media protocol. It can break without notice.
- One encode per screen in software, on the Docker host. 720p30 is comfortable. 1080p60 wants a real CPU.
- No pause, subtitles or audio track choice.
- The queue and skip votes live in memory. A restart clears them.
- Web viewers each pull the full stream bitrate. There is no lower quality rendition.
- Requester pings are lost on restart.
