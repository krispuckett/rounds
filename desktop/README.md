# Rounds desktop for Windows

The optional Electron shell packages the existing Rounds canvas and server as a Windows x64 application. The original Node CLI remains available. Desktop canvases listen on an available loopback port; no public tunnel is needed.

## Build

From the repository root:

```powershell
npm ci --include=dev
npm run build
cd desktop
npm ci --include=dev
npm run demo -- --smoke
npm run dist
```

The NSIS installer is in `desktop/release/`. It is unsigned unless a signing certificate is configured. It creates Start menu and desktop shortcuts. Windows taskbar pinning is managed by Windows.

## Settings

- **Integrations:** one row per provider with discovered CLI/desktop capabilities and account counts. Legacy Gemini CLI is detected under Google Antigravity; legacy Windsurf under Devin.
- **Accounts:** Claude and Codex profiles can be identified through their own CLIs. Only matching verified identities are grouped; unknown profiles remain distinct. Names and enabled choices persist locally. New profiles default to disabled. No credential files are parsed.
- **Usage:** Codex quota windows use the installed CLI's account/rateLimits/read protocol. Claude quota comes from the optional documented status-line input described below. Missing or expired metrics are shown as unavailable, not as zero. Selected accounts refresh while Settings is open.
- **General:** optional login startup, close-to-tray and reopening when Claude or Codex desktop windows are detected. The installed app supports startup registration. The watcher runs while Rounds is resident.

Only selected Claude Code and Codex profiles are read by desktop mode. Each enabled source set has a separate local canvas cache, so changing the selection restarts Rounds and cannot bring a disabled profile's old cache into the new canvas. Returning to the same selection returns its saved history. Desktop profile selection does not yet associate Claude Desktop transcript roots with accounts; standalone CLI supports compatible desktop session directories through ROUNDS_DESKTOP_SESSIONS. Other providers are discovery-only.

Desktop canvas feedback is retained locally until an appropriate session-delivery integration is configured. The original CLI retains its existing Claude MCP and hook support. The Codex reader originates from Kaan Eryilmaz's upstream PR #4, with Windows and source-selection fixes; it reads databases without modifying them. Node versions without SQLite skip Codex; for early Node 22, use the experimental SQLite flag, or use the packaged desktop runtime.

## Claude quota capture (optional)

Claude Code documents rate-limit percentages in its status-line JSON input: https://code.claude.com/docs/en/statusline. Rounds supplies `claude-statusline.mjs`, which stores only reported quota percentages and reset times in a snapshot inside that profile. Configure it as a status-line command using an installed Node executable, for example:

```json
{ "statusLine": { "type": "command", "command": "node \"C:/path/to/rounds/desktop/claude-statusline.mjs\"" } }
```

Do not replace an existing status line without preserving its behavior. The snapshot updates when Claude Code provides rate-limit data. Rounds does not read OAuth credentials or make a model call to obtain Claude quota.

Provider marks are bundled from the pinned MIT-licensed Lobe Icons static SVG package; trademarks belong to their respective owners. They identify integrations and do not imply endorsement. Google Antigravity's press kit is at https://www.antigravity.google/press.

## Verification

```powershell
node --test desktop/providers.test.mjs desktop/account-info.test.mjs desktop/managed-sources.test.mjs
node --test evals/platform.test.mjs
node --experimental-sqlite --test evals/codex.test.mjs
node evals/windows-smoke.mjs
npm --prefix desktop run demo -- --smoke
```

Smoke mode uses isolated fixtures and never indexes real sessions. Login startup, tray lifecycle and agent-window detection need interactive Windows verification.
