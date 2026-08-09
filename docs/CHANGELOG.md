# Changelog

All notable changes to PESUClaw will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-03-19

### Fixed
- Fixed CORS issues when downloading files for merging by adding `files.pesuacademy.com` to permissions and declarativeNetRequest rules for Chrome.

## [1.1.0] - 2026-03-09

### Added
- Firefox support (Manifest V2) with `loader.js` for MAIN-world script injection
- `browser_specific_settings.gecko` in Firefox manifest (ID: `pesuclaw@pesuacademy`, min version 91)
- Monorepo structure: shared source in `src/`, platform-specific files in `platforms/`
- Build scripts (`build.ps1` for Windows, `build.sh` for Linux/macOS) to assemble both versions
- GitHub Actions workflow for automated releases — push a version tag to create a release with pre-built zips
- `--zip` / `-Zip` flag on build scripts to produce ready-to-distribute zip packages locally

### Changed
- Moved shared files (`content.js`, `popup.html`, `panel.css`, `lib/`, `icons/`) into `src/`
- Moved Chrome `manifest.json` into `platforms/chrome/`
- Updated all documentation for cross-browser monorepo workflow

## [1.0.0] - 2026-02-25

### Added
- Chrome extension (Manifest V3) with content script injection
- "PESUClaw" tab injected into PESU Academy course unit navigation
- Floating download panel with file listing and progress bar
- PDF merging — all PDF slides merged into a single file via pdf-lib
- PPTX zipping — all PowerPoint files bundled into a ZIP via JSZip
- Individual file download via click
- In-memory caching per unit tab — instant re-renders on tab switch
- Automatic tab change detection via MutationObserver
- Force refetch button to bypass cache
- PESU Academy themed UI (#0091CD blue, #1d3756 dark text)
- Toolbar popup with usage instructions
- Bundled pdf-lib v1.17.1 and JSZip v3.10.1 locally (no CDN)
