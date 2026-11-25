# Commands

There are two ways to give commands. Both do the same things.

- **Slash commands** need a bot (`BOT_TOKEN`). This is the better way.
- **Chat commands** are typed with a `!` in one text channel (`COMMAND_CHANNEL_ID`). No bot needed.

## Slash commands

| Command | Option | What happens |
|---|---|---|
| `/play` | `title` | Plays a movie or episode. Start typing and pick from the list. After a `/search` you can also give a result number. |
| `/random` | | Plays one random movie. |
| `/shuffle` | `list` (optional) | Plays random movies back to back until `/stop` or `/live`. Pick a list to shuffle only that playlist. |
| `/search` | `query` | Lists matching movies and episodes. Only you see the results. |
| `/seek` | `time` | Jumps to a time in the current video. Takes `45:00`, `1:02:03` or plain seconds. |
| `/request` | `title` | Asks Seerr for a movie or show that is not in the library. Start typing and pick from the list. |
| `/np` | | Shows what is playing and how far in. |
| `/skip` | | Moves on to the next thing. In shuffle it stays in shuffle. |
| `/live` | | Goes back to the live feed. |
| `/stop` | | Stops streaming. The account stays in the voice channel. |

Which commands show up depends on what you set up:

| Command | Needs |
|---|---|
| `/play`, `/random`, `/shuffle`, `/search`, `/seek` | Jellyfin |
| The `list` option on `/shuffle` | `SHUFFLE_LISTS` |
| `/request` | Seerr |
| `/live` | A live feed (on by default) |
| `/np`, `/skip`, `/stop` | Nothing. Always there. |

## Chat commands

The prefix is `!` unless you change `COMMAND_PREFIX`.

| Command | Also works as | What happens |
|---|---|---|
| `!play 2` | | Plays number 2 from the last search. |
| `!play alien` | | Plays the best match for a title. |
| `!random` | | Plays one random movie. |
| `!shuffle` | | Random movies back to back. |
| `!shuffle christmas` | | Shuffles one list. |
| `!search alien` | `!find` | Lists matching movies and episodes. |
| `!seek 45:00` | | Jumps to a time. |
| `!request alien` | | Asks Seerr for the best match. |
| `!np` | `!now` | Shows what is playing. |
| `!skip` | `!next` | Moves on to the next thing. |
| `!live` | | Goes back to the live feed. |
| `!stop` | | Stops streaming. |
| `!help` | | Prints the list. |

## Who can use them

By default, anyone who can run commands in the server can use all of them.

- Set `ALLOWED_USER_IDS` or `ALLOWED_ROLE_IDS` to limit every command to those people.
- For slash commands you can also set this per command in Server Settings, Integrations. That is the place to lock down `/request`.

## What is not there

- Pause. Use `/stop`, then `/play` and `/seek` to get back to where you were.
- Subtitles.
- A queue. One thing plays at a time.
- Picking an audio track. You get the first one in the file.
