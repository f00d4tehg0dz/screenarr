# Commands

There are two ways to give commands. Both do the same things.

- **Slash commands** need a bot (`BOT_TOKEN`). This is the better way.
- **Chat commands** are typed with a `!` in one text channel (`COMMAND_CHANNEL_ID`). No bot needed.

## Slash commands

| Command | Option | What happens |
|---|---|---|
| `/play` | `title` | Plays a movie or episode. Start typing and pick from the list. After a `/search` you can also give a result number. If someone's pick is already on, yours joins the queue. |
| `/random` | | Plays one random movie. Queues the same way `/play` does. |
| `/shuffle` | `list` (optional) | Plays random movies back to back until `/stop` or `/live`. Pick a list to shuffle only that playlist. |
| `/search` | `query` | Lists matching movies and episodes. Only you see the results. |
| `/seek` | `time` | Jumps to a time in the current video. Takes `45:00`, `1:02:03` or plain seconds. |
| `/request` | `title` | Asks Seerr for a movie or show that is not in the library. Start typing and pick from the list. |
| `/queue show` | | Shows what is on and what is lined up, and who picked each. |
| `/queue remove` | `position` | Takes one thing out of the line. |
| `/queue clear` | | Empties the line. |
| `/np` | | Shows what is playing and how far in. |
| `/skip` | | Moves on to the next thing. See [Skipping](#skipping). |
| `/live` | | Goes back to the live feed. Empties the queue. |
| `/stop` | | Stops streaming. Empties the queue. The account stays in the voice channel. |
| `/status` | | Uptime, what is connected, recent errors. Only you see the answer. |

Which commands show up depends on what you set up:

| Command | Needs |
|---|---|
| `/play`, `/random`, `/shuffle`, `/search`, `/seek`, `/queue` | Jellyfin |
| The `list` option on `/shuffle` | `SHUFFLE_LISTS` |
| `/request` | Seerr |
| `/live` | A live feed (on by default) |
| `/np`, `/skip`, `/stop`, `/status` | Nothing. Always there. |

`/status` is hidden from everyone but server admins. Change that in Server Settings, Integrations.

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
| `!queue` | `!q` | Shows what is lined up. |
| `!queue remove 2` | | Takes number 2 out of the line. |
| `!queue clear` | | Empties the line. |
| `!np` | `!now` | Shows what is playing. |
| `!skip` | `!next` | Skips, or votes to skip. |
| `!live` | | Goes back to the live feed. |
| `!stop` | | Stops streaming. |
| `!status` | | Uptime, what is connected, recent errors. |
| `!help` | | Prints the list. |

## The queue

The first `/play` starts right away. While that pick is on, every `/play` and `/random` after it lines up behind it. When one ends, the next starts. When the line is empty, the screen goes back to the live feed or the idle content.

- Things that take the screen away empty the queue: `/stop`, `/live`, `/shuffle`, and the live feed coming up.
- A pick made while shuffle or idle content is on plays right away. Nobody chose what it interrupts.
- `/seek` does not touch the queue.
- The queue holds 50 by default (`QUEUE_MAX`).
- It lives in memory. A restart empties it.

## Skipping

| What is on | What `/skip` does |
|---|---|
| Your own pick | Skips. |
| Someone else's pick | Counts as a vote. It skips once more than half the people in the voice channel have voted. |
| A shuffle or idle pick, or the live feed | Skips. Nobody chose it. |
| Anything, and you are an admin | Skips. |

Votes only count from people in the voice channel, and start over with each new item. Change the share needed with `SKIP_VOTE_RATIO`.

## Admins

Set `ADMIN_USER_IDS` or `ADMIN_ROLE_IDS`. Admins can skip without a vote, remove anyone's pick, clear the queue and see `/status`.

With no admins set, nobody can skip past a vote, anyone can remove or clear queue entries, and anyone can run `!status`.

## Who can use them

By default, anyone who can run commands in the server can use all of them.

- Set `ALLOWED_USER_IDS` or `ALLOWED_ROLE_IDS` to limit every command to those people.
- For slash commands you can also set this per command in Server Settings, Integrations. That is the place to lock down `/request`.

## What is not there

- Pause. Use `/stop`, then `/play` and `/seek` to get back to where you were.
- Subtitles.
- Picking an audio track. You get the first one in the file.
