# Release v1.2.1 — 2026-08-09

This release prepares the project for publishing under the new product name: PESUClaw.

## Summary
- Rename: Replace old product name `ClawdMate` with `PESUClaw` in release artifacts and GitHub Actions workflow.
- Updated: `.github/workflows/release.yml` now produces `PESUClaw-Chrome-<tag>.zip` and `PESUClaw-Firefox-<tag>.zip` and uses `PESUClaw <tag>` as the release title.

## Changes
- Workflow: Updated artifact filenames and release metadata in `.github/workflows/release.yml`.

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
git commit -m "chore(release): prepare PESUClaw release v1.2.1"
git tag v1.2.1
git push origin HEAD --tags
```

3. Or create a GitHub release locally with the `gh` CLI and attach the generated zip files:

```bash
gh release create v1.2.1 build/PESUClaw-Chrome-v1.2.1.zip build/PESUClaw-Firefox-v1.2.1.zip --title "PESUClaw v1.2.1" --notes-file docs/RELEASE_DRAFT_v1.2.1.md
```

If you'd like, I can create the git tag and push it for you (requires repo remote access).
