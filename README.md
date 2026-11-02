# PESUClaw

A browser extension for **Chrome** and **Firefox** that adds bulk downloading of course materials from [PESU Academy](https://www.pesuacademy.com/Academy/). Download slides, notes, assignments, question banks, and question answers — merge PDFs, zip everything else, or grab a whole course in one go — right from the course page.

## Features

### Picking what to download
- **PESUClaw tab** — appears alongside your course unit tabs and inherits PESU's own tab styling, so it stays readable on light and dark pages
- **Multiple resource types at once** — toggle Slides, Notes, Assignments, QB, and QA together; each gets its own collapsible card
- **Choose your files** — every file has a checkbox, with **All / None** per card, so you only download what you tick
- **Quick filter** — a search box appears on long lists to narrow files by title or class name
- **Live file counts** — resource chips show how many files each scanned type contains
- **Caching** — switching between unit tabs and resource types is instant after the first fetch
- **Auto-detect** — the panel updates automatically when you switch unit tabs

### Downloading
- **PDF merge with bookmarks** — all PDFs combined into one file via pdf-lib, with one bookmark per source file so long merged documents are easy to navigate
- **ZIP bundling that keeps real extensions** — non-PDF files (PPTX, DOCX, XLSX, ODT, EPUB, legacy DOC/PPT/XLS, archives, etc.) go into one ZIP and keep their original extensions; file types are identified from the file contents, not just the filename
- **Download several types together** — with more than one type selected you get a single ZIP with a folder per type, PDFs already merged inside
- **Download all units** — one button visits every unit tab and bundles the selected types per unit into a single `PESU_AllUnits_….zip` (folder per unit and type). You can cancel mid-run, and the tab you started on is restored afterwards
- **Individual downloads** — each row has its own download button, using the same numbered, descriptive filenames as bundled files instead of opaque server filenames
- **Smart naming** — ZIP entries are named `(number)_title.ext` with duplicate disambiguation

### Office helper
- **Office merge helper** — any bundle containing DOC, DOCX, PPT, or PPTX files includes `merge_office_files.py`, which converts them to PDF with LibreOffice (or desktop Microsoft Office on Windows) and merges them in numbered order with `pypdf`, adding a bookmark per file
- **One script for everything** — in multi-type and all-units ZIPs a single script handles every folder and writes each `…_Office_Merged.pdf` next to its files
- **Setup helpers** — bundles also include `requirements.txt`, `run_merge_windows.bat`, and `run_merge_linux.sh` to install the Python dependencies and run the helper

### Interface
- **Dark panel, always** — the panel and toolbar popup use a consistent dark theme regardless of PESU's own theme
- **Clear states** — loading skeletons, a progress bar with Cancel during long runs, per-file result chips (for example "2 pg merged", "zipped .pptx"), plus empty and error views with a **Try again** button
- **Keyboard friendly** — `Esc` closes the panel; controls have visible focus states
- **GitHub update check** — the panel footer and toolbar popup check the latest GitHub release and link to the download when a newer version is available. If GitHub's API is rate-limited, the check falls back to the public tag list on jsDelivr
- **Cached update checks** — results are cached for six hours; failed checks back off for 30 minutes
- **Release links** — the panel footer and popup link straight to the latest releases and the GitHub repo

## Installation

1. Go to the [Releases page](https://github.com/AAK1767/PESUClaw/releases/latest)
2. Download the zip for your browser:
   - **Chrome** → `PESUClaw-Chrome-vX.X.X.zip`
   - **Firefox** → `PESUClaw-Firefox-vX.X.X.zip`
3. Unzip it to a folder

### Chrome (recommended)
4. Open `chrome://extensions` → enable **Developer mode**
5. Click **Load unpacked** → select the unzipped folder
6. The extension stays installed until you remove it

### Firefox
4. Open `about:debugging` → **This Firefox** → **Load Temporary Add-on**
5. Select `manifest.json` inside the unzipped folder

> ⚠️ Firefox temporary add-ons are removed when you close Firefox. You'll need to repeat steps 4–5 each time you restart the browser.

### Updating
Download the newest release zip and replace your unzipped folder's contents, then click the reload icon for PESUClaw on `chrome://extensions`. The panel footer and toolbar popup tell you when a newer version exists.

### From source (developer mode)

1. Clone and build:
   ```bash
   git clone https://github.com/AAK1767/PESUClaw.git
   cd PESUClaw
   ./build.sh          # or .\build.ps1 on Windows
   ```

2. **Chrome**:
   - Open `chrome://extensions` → enable **Developer mode**
   - Click **Load unpacked** → select the `build/chrome` folder

3. **Firefox**:
   - Open `about:debugging` → **This Firefox** → **Load Temporary Add-on**
   - Select `build/firefox/manifest.json`

### Prerequisites

- Google Chrome (or a Chromium-based browser) **or** Mozilla Firefox 91+
- A valid PESU Academy student account
- *Optional, for the Office merge helper:* Python 3, plus LibreOffice (or desktop Microsoft Office on Windows)

## Usage

1. Log in to [PESU Academy](https://www.pesuacademy.com/Academy/)
2. Navigate to **My Courses → [Your Subject] → Course Units**
3. Click the **PESUClaw** tab at the end of the unit tabs
4. Pick one or more resources: **Slides**, **Notes**, **Assignments**, **QB**, or **QA**
5. Tick the files you want (all are ticked by default) and use the filter if the list is long
6. Click the main **Download** button:

| You selected | You get |
|--------------|---------|
| One type | `Unit_Type_Merged.pdf`, plus `Unit_Type_files.zip` if there are non-PDF files |
| Several types | One ZIP with a folder per type, each holding its merged PDF and a `files/` folder |
| **All units** | One `PESU_AllUnits_<types>.zip` with a folder per unit and type |

7. Use **Cancel** to stop a long run — nothing is downloaded if you cancel.
8. To grab just one file, use the download icon at the end of its row.

### About "All units"

PESUClaw reads each unit by clicking the page's own unit tabs, so you will see them change while it runs. It switches back to the tab you started on, and units with no listed content are skipped and named in the result message.

### Merging Office files

If your ZIP contains DOC/DOCX/PPT/PPTX files, extract it and run `run_merge_windows.bat` (Windows) or `./run_merge_linux.sh` (Linux/macOS). The launcher installs the packages from `requirements.txt` and produces `…_Office_Merged.pdf` files with bookmarks.

> **Note:** Please disable any download managers (IDM, FDM, JDownloader, etc.) or their browser extensions before using PESUClaw. They intercept file downloads and interfere with PDF merging and ZIP bundling.

## How it works

The extension injects a content script into PESU Academy pages. It reads the active unit and its class rows from the page itself, asks the academy's own endpoints (the same ones the website uses) for the download links of each class and resource type, then fetches and processes the files client-side.

| Step | What happens |
|------|-------------|
| 1 | Reads the active unit tab and waits until the page shows that unit's content |
| 2 | Collects the unit's class rows and the subject ID from the page DOM |
| 3 | For each class and selected resource type, requests the class page and extracts download links |
| 4 | Fetches each selected file and identifies its real type from its contents |
| 5 | Merges PDFs (adding bookmarks) and zips everything else, all client-side |

For **All units**, PESUClaw repeats steps 1–5 for every unit tab in turn and finally switches back to the tab you started on.

All file processing happens in your browser.

## Known drawbacks

- Only PDF files can be merged directly in the browser. Everything else (PPTX, DOC, DOCX, XLSX, etc.) goes into a ZIP instead of being converted.
- Office bundles include a Python helper and launchers to convert and merge DOC/DOCX/PPT/PPTX. LibreOffice is preferred; Windows users can use desktop Microsoft Office instead. Other formats such as XLSX are zipped but not merged.
- Converting Office formats to PDF inside a browser extension is not reliably possible without external conversion services, so PESUClaw does not attempt in-extension conversion.
- Bookmarks that already exist inside the original PDFs are not carried over; the merged PDF gets one bookmark per source file instead.
- Everything is held in memory until the ZIP is built, so downloading a very large course in one go can use a lot of RAM.
- Single-type downloads produce two files (a PDF and a ZIP), so your browser may ask whether to allow multiple downloads from `pesuacademy.com`.

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| Footer says "Update check unavailable" | Hover over it to see the error. It is usually a network block or a GitHub rate limit (common on shared campus networks); PESUClaw retries automatically after a while. Use **Latest releases** in the footer to check by hand. |
| A unit shows "Something went wrong" | PESU hadn't finished loading it. Wait a moment and click **Try again** (or the rescan button in the panel header). |
| "All units" skips a unit | PESU may not have loaded it in time. Open that unit manually and rescan, or run it again. |
| A file lands in the ZIP with the wrong extension | Open the browser console and look for a `[PESUClaw] Treating as ZIP` warning, then open an issue with the file type. |
| Downloads are missing or garbled | Disable download managers such as IDM, FDM, or JDownloader. |

## Supported resource types

| Type | ID | Description |
|------|----|-------------|
| Slides | 2 | Lecture slide decks (PDF/PPTX) |
| Notes | 3 | Course notes and handouts |
| Assignments | 5 | Assignment documents |
| QB | 6 | Question bank files |
| QA | 7 | Question & answer documents |

## Project structure

```
PESUClaw/
├── src/                         # Shared source (both browsers)
│   ├── content.js               # Main content script — UI + fetch + merge logic
│   ├── popup.html               # Extension popup (toolbar icon click)
│   ├── popup.js                 # Popup logic — version display and update check
│   ├── panel.css                # Styles for the download panel and tab
│   ├── lib/
│   │   ├── pdf-lib.min.js       # PDF merging library (v1.17.1)
│   │   └── jszip.min.js         # ZIP creation library (v3.10.1)
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
├── platforms/
│   ├── chrome/
│   │   └── manifest.json        # Chrome Manifest V3
│   └── firefox/
│       ├── manifest.json        # Firefox Manifest V2
│       └── loader.js            # MAIN-world script injector
├── build.ps1                    # Build script (Windows)
├── build.sh                     # Build script (Linux/macOS)
├── build/                       # Assembled extensions (gitignored)
│   ├── chrome/
│   └── firefox/
├── LICENSE                      # MIT License
└── docs/
    ├── CHANGELOG.md             # Release history
    ├── CODE_OF_CONDUCT.md       # Community standards
    ├── CONTRIBUTING.md          # Contribution guidelines
    ├── DEVELOPER.md             # Technical architecture docs
    └── SECURITY.md              # Security policy
```

## Tech stack

- **Chrome**: Manifest V3 — content scripts injected with `"world": "MAIN"`
- **Firefox**: Manifest V2 — content script injects page-level `<script>` tags via `loader.js`
- **pdf-lib** v1.17.1 — client-side PDF merging and bookmarks
- **JSZip** v3.10.1 — client-side ZIP creation
- **jQuery** — from PESU Academy's page (not bundled)
- **pypdf** — used only by the optional Office merge helper that ships inside ZIP bundles

## Privacy

PESUClaw runs entirely in your browser. It does not:

- Collect or transmit any personal data
- Send analytics or telemetry
- Upload your files or course content anywhere
- Store data beyond the current page session, apart from a small cached copy of the latest-release check

The extension reads PESU Academy using your existing session cookies. The only other network requests it makes are the optional update check, which asks GitHub's public API (and, if that fails, jsDelivr's public tag list) for the latest release version. No personal data or course content is included in those requests.

## License

This project is licensed under the [MIT License](LICENSE). See [CONTRIBUTING](docs/CONTRIBUTING.md) to get involved.

## Author

**AAK1767**

Forked from [PESUmate](https://github.com/mohitpaddhariya/PESUmate) by Mohit Paddhariya.

## Acknowledgments

- Original project [PESUmate](https://github.com/mohitpaddhariya/PESUmate) by Mohit Paddhariya
- [pdf-lib](https://pdf-lib.js.org/) by Andrew Dillon
- [JSZip](https://stuk.github.io/jszip/) by Stuart Knightley