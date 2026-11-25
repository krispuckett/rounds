<p align="center">
  <img src="docs/rounds-mark.svg" width="72" alt="">
</p>

<h1 align="center">Rounds</h1>

<p align="center">Everything your Claude Code sessions make, on one canvas.</p>

[![The Rounds canvas](docs/rounds-og.png)](docs/rounds-film.mp4)

<p align="center"><a href="docs/rounds-film.mp4">Watch the film</a></p>

I run a lot of Claude Code sessions at once and kept losing track of what each one made. Now it
all lands in one place, and I can leave notes on it.

## Try it

```bash
npx github:krispuckett/rounds --demo
```

The demo is six of my public projects and the real notes I left on them. It runs in its own
folder and doesn't touch your setup.

## What it does

Screens, pages and pushes from every session, sorted by project.

![The Road, one of the projects on the canvas](docs/canvas-project.jpg)

Pin a note on a screen. The session that made it gets the note, makes the fix and replies.

![A note on a screen, with the session's reply](docs/canvas-note.jpg)

Drag to compare a screen with the one it replaced.

![A sky before and after a fix](docs/canvas-compare.jpg)

Step back to any day to see what was made on it.

![Earlier days stacked behind the current one](docs/canvas-time.jpg)

Search a session by name, or tap a group's title in the timeline, to see only that session's
work, newest first.

The files a session changed sit on a sheet beside its screens. Open one to read every change
line by line, and to see which other sessions changed it too.

If you use Codex too, its sessions show up beside Claude's, with no setup: the images it showed
you or generated, the files it changed, and its sessions by name. Codex chats with no project
sit together under Codex chats, and a Codex session's title opens it in Codex. Notes on Codex
screens stay on the canvas; they don't reach the session.

Claude Code deletes terminal sessions after 30 days by default. What they made stays on your
canvas, and so does every page they published, even after its folder is cleared.

## Set it up

You need a Mac, Node 20 or newer, and Claude Code. Rounds reads the sessions that run on your
Mac; sessions in the cloud don't reach it.

```bash
npx github:krispuckett/rounds init
```

This adds an MCP server, a skill and two hooks to Claude Code, and asks before each one. Then
open the canvas:

```bash
npx github:krispuckett/rounds
```

Opening it this way also brings in the newest Rounds, hooks included. While it stays open, it
checks once a day, and when there's a new version an Update button shows in the dock. Press it
and Rounds brings that version in and starts again where it was. The next Claude session you type
in mentions a new version once too, even with the canvas closed. If you set it up before 1.1,
run `init` once more so it keeps every page your sessions publish.

To take it all out:

```bash
npx github:krispuckett/rounds uninstall
```

## Privacy

Everything stays in `~/.rounds` on your Mac, and websites can't reach it. Codex sessions are
read from the Codex app's own files in `~/.codex`, which Rounds only reads and never changes. To sort older screens
into topics, Rounds asks Claude Haiku through your own Claude Code, sending each one's caption, session
name and file names. Once a day it asks GitHub whether there's a newer Rounds; nothing from your
canvas goes with it, and `"updates": false` in the config turns it off.

<details>
<summary>More</summary>

### Tools

Sessions post with `rounds_post` and `rounds_change`, read notes with `rounds_notes` and answer
them with `rounds_reply`. One hook brings each session its notes with your next message. The
other ties posts to their session, keeps a copy of each page a session publishes, and notices
pushes to main.

In auto mode, Claude Code may ask you before acting on a note. Say yes and it carries on.

### Keys

| Key | Does |
| --- | --- |
| T | Timeline |
| ← → | Back or forward through the days with work |
| / or ⌘K | Search |
| + − 0 | Zoom in, zoom out, fit everything |
| Space | Hold to pan, or to see the before while comparing |
| Esc | Back out |

Scroll pans and pinch zooms, in the timeline too; scrolling over its rail moves through
the days. Drop an image or an HTML file on the canvas to add it to a project.

### Config

`~/.rounds/config.json`, every field optional:

```json
{
  "projects": [{ "key": "shop", "name": "Shop", "match": ["shop", "storefront"] }],
  "private": ["acme-internal"],
  "port": 4797,
  "updates": true
}
```

`projects` groups work by words in its session, folder or caption. Anything matching `private`
never shows up. `ROUNDS_HOME` and `ROUNDS_PORT` override the folder and the port.

### Develop

```bash
npm install
npm run dev     # the canvas, on :4797
npm run eval    # the whole loop with real Claude sessions
```

A release is a version tag on GitHub: `npm run release` checks that the version in
`package.json` is new and pushed, then tags it and writes its release notes. Copies opened with
npx see it within a day.

</details>

## License

MIT. Made by [Kris Puckett](https://krispuckett.com).
