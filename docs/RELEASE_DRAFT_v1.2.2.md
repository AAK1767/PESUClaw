# Release v1.2.2 — 2026-08-11

This release adds an in-popup GitHub update check and fixes chapter switching while the PESUClaw tab remains open.

## Summary
- Added: The extension popup now checks GitHub releases and highlights when a newer version is available.
- Fixed: Switching chapters no longer breaks PESUClaw when the tab is already open; the content script waits for the active unit content to refresh before scanning.

## Changes
- Popup: Added a GitHub release check, update status banner, and badge notification.
- Build: Updated both build scripts to package `popup.js`.
- Permissions: Allowed the popup to call the GitHub releases API.
- Content script: Improved chapter switching so an open PESUClaw panel re-renders correctly after PESU Academy updates the page.

## How to publish
1. Build local extension artifacts:

```bash
# From repo root
chmod +x build.sh
./build.sh --zip
```

2. Create a git tag locally and push it (this will trigger the GitHub Actions release workflow):

```bash
git add .
git commit -m "chore(release): prepare PESUClaw release v1.2.2"
git tag v1.2.2
git push origin HEAD --tags
```

3. Or create a GitHub release locally with the `gh` CLI and attach the generated zip files:

```bash
gh release create v1.2.2 build/PESUClaw-Chrome-v1.2.2.zip build/PESUClaw-Firefox-v1.2.2.zip --title "PESUClaw v1.2.2" --notes-file docs/RELEASE_DRAFT_v1.2.2.md
```

If you'd like, I can create the git tag and push it for you (requires repo remote access).
