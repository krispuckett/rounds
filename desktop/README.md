# Windows desktop preview

The optional Electron shell packages the existing Rounds canvas and server as a Windows x64 desktop app. The original Node CLI remains unchanged. The desktop app uses a loopback-only server on an available port; it does not require a tunnel.

## Build from the repository root

```powershell
npm ci --include=dev
npm run build
cd desktop
npm ci --include=dev
npm run demo -- --smoke
npm run dist
```

The NSIS installer is in `desktop/release/`. It is unsigned unless the builder is configured with an appropriate signing certificate. The installer creates Start menu and desktop shortcuts; Windows taskbar pinning is a user action.

## Run

- `npm start` runs the desktop app from source using the standard Rounds data directory.
- `npm run demo` opens a separate, temporary sample canvas and does not read live transcripts.
- The Rounds menu and tray menu provide optional startup at login (packaged application only), visibility when a Claude or Codex desktop window is detected, and close-to-tray behavior.
- Desktop launch detection runs only while Rounds is running, and currently uses visible Windows process names. It does not claim to support every possible installation or detect CLI sessions.
- The normal Node-based Claude Code MCP and hook setup is still performed separately through the existing Rounds init command. The desktop shell does not silently modify provider configuration.
- No desktop-specific Codex indexing, account switching, account discovery, usage monitoring, or feedback delivery has been added yet.

## Verification

The source desktop shell and packaged executable were smoke-tested using isolated sample data on Windows. The unsigned installer was built; interactive installation, login behavior, tray lifecycle, and automatic window detection still require real desktop testing.
