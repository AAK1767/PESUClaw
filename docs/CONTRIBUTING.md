# Contributing to PESUClaw

Thank you for considering contributing to PESUClaw! This document outlines how to get involved.

## How to contribute

### Reporting bugs

1. Check [existing issues](https://github.com/AAK1767/PESUClaw/issues) to avoid duplicates
2. Open a new issue with:
   - A clear, descriptive title
   - Steps to reproduce the bug
   - Expected vs actual behavior
   - Browser version and OS
   - Screenshots or console logs if applicable

### Suggesting features

Open an issue with the `enhancement` label. Describe:
- What problem the feature solves
- How you envision it working
- Any alternatives you've considered

### Submitting code

1. **Fork** the repository
2. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes** — keep commits focused and atomic
4. **Test** your changes:
   - Run `./build.sh` (or `.\build.ps1`) to rebuild
   - Load the extension in Chrome and/or Firefox developer mode
   - Verify on a live PESU Academy course page
   - Check the browser console for errors
5. **Push** your branch and open a **Pull Request**

## Development setup

```bash
git clone https://github.com/AAK1767/PESUClaw.git
cd PESUClaw
./build.sh          # or .\build.ps1 on Windows
```

This builds both browser versions into `build/chrome/` and `build/firefox/`.

### Chrome
1. Open `chrome://extensions` → enable **Developer mode**
2. Click **Load unpacked** → select the `build/chrome` folder
3. Navigate to PESU Academy to test

### Firefox
1. Open `about:debugging` → **This Firefox** → **Load Temporary Add-on**
2. Select `build/firefox/manifest.json`
3. Navigate to PESU Academy to test

After making changes in `src/` or `platforms/`:
- Re-run the build script
- Chrome: click the refresh icon on the extension card
- Firefox: click **Reload** in `about:debugging`
- Reload the PESU Academy page

See [DEVELOPER.md](DEVELOPER.md) for architecture details (in this same `docs/` folder).

## Code style

- Use `'use strict'` in all scripts
- Prefer `const` and `let` over `var`
- Use meaningful variable names
- Keep functions focused — one responsibility per function
- Add `[PESUClaw]` prefix to all `console.log` messages
- No external dependencies beyond pdf-lib and JSZip (both bundled)
- jQuery is used from the host page — do not bundle it

## Commit messages

Use clear, concise commit messages:

```
feat: add batch download progress percentage
fix: handle empty unit response from API
docs: update developer guide with caching section
style: align panel close button
refactor: extract file type detection into helper
```

Prefix with: `feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `test:`, `chore:`

## Pull request guidelines

- Reference any related issues (e.g., "Fixes #12")
- Describe what changed and why
- Keep PRs focused — one feature or fix per PR
- Ensure no console errors on PESU Academy pages
- Update documentation if your change affects usage or architecture

## What we're looking for

- Bug fixes and reliability improvements
- Support for additional file types
- UI/UX improvements to the download panel
- Performance optimizations
- Better error handling and user feedback
- Documentation improvements

## Code of conduct

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md) (in this same `docs/` folder). By participating, you agree to uphold it.

## Questions?

Open an issue with the `question` label or reach out to the maintainer.
