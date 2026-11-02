# Changelog

All notable changes to PESUClaw will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-11-02

### Added
- Added per-file selection with All/None controls and quick filtering for resource lists.
- Added multi-type downloads and one-click all-unit downloads, with organized ZIP folders and cancellation support.
- Added bookmarks to merged PDFs and the Office merge helper output.
- Added automatic Office file detection and a bundled merge helper with setup scripts.

### Changed
- Redesigned the download panel with a consistent dark theme, clearer loading and progress states, keyboard focus styles, and richer result summaries.
- Improved archive and Office-file naming so downloaded files keep their actual extensions.
- Removed duplicate resource links found within the same class.

## [1.2.7] - 2026-10-30

### Changed
- Added a visible version footer with links to the GitHub repository and releases.
- Added jsDelivr tag metadata fallbacks and shorter retry caching for release update checks when the GitHub API is unavailable or rate-limited.

## [1.2.6] - 2026-10-30

### Fixed
- Fixed Office files being saved as `.zip` when the download response did not expose a useful filename or MIME type.
- Inspected ZIP Office metadata to preserve `.docx` and `.pptx` extensions while keeping genuine ZIP archives as `.zip`.
- Continued including `merge_office_files.py` and its setup helpers whenever Office files are bundled.

## [1.2.5] - 2026-10-30

### Fixed
- Fixed DOC, DOCX, and PPTX files being misclassified as archives because Office Open XML files use ZIP containers internally.
- Preserved Office files as Office entries so `merge_office_files.py` is included and can convert them to a merged PDF.
- Added MIME-type fallback detection for Office files when the server does not provide a filename.

## [1.2.4] - 2026-10-14

### Added
- Added generated filenames for individual downloads so downloaded files match the numbered names used in bundles.
- Added Office bundle setup files (`requirements.txt` and platform launchers) for installing dependencies and running the merge helper.
- Added six-hour caching for GitHub release checks.
- Added broader archive detection for ZIP, RAR, 7z, TAR, GZIP, and TGZ files.
- Added detailed processing summaries for merged PDFs, Office files, archives, and failures.
- Added a dark theme with improved contrast, spacing, controls, status colors, and keyboard focus states.

## [1.2.3] - 2026-10-14

### Added
- Added `.zip`, `.rar`, and `.7z` archive detection without incorrectly renaming archives as PPTX files.
- Added `merge_office_files.py` to Office-file ZIP bundles for ordered DOC, DOCX, and PPTX to PDF conversion and merging.
- Added LibreOffice, Microsoft Office, and Python package fallbacks with explicit installation instructions.
- Made the GitHub update prompt explicitly tell users to download and install new releases.

## [1.2.2] - 2026-08-11

### Changed
- Added a GitHub release check in the extension popup and packaged the popup script in both build outputs.
- Allowed the popup to query GitHub's release API so update availability can be shown immediately.

### Fixed
- Fixed chapter switching while the PESUClaw tab stays open by waiting for PESU Academy to finish updating the active unit's content before scanning it.

## [1.1.1] - 2026-03-19

## [1.2.1] - 2026-08-11

### Changed
- Renamed release artifacts and release metadata from `ClawdMate` to `PESUClaw` in the GitHub Actions workflow (`.github/workflows/release.yml`).
- Added release draft with publish instructions for `v1.2.1` in `docs/RELEASE_DRAFT_v1.2.1.md`.

### Fixed
- Fixed CORS issues when downloading files for merging by adding `files.pesuacademy.com` to permissions and declarativeNetRequest rules for Chrome.
- Fixed chapter switching while the PESUClaw tab stays open by waiting for PESU Academy to finish updating the active unit's content before scanning it.

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
