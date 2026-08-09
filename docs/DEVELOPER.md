# PESUClaw — Developer Guide

Technical documentation covering the architecture, API flow, and internals of the PESUClaw browser extension (Chrome & Firefox).

---

## Architecture

PESUClaw injects a content script into PESU Academy pages. The content script adds UI elements to the DOM and communicates with PESU Academy's internal APIs using the user's existing session.

### Chrome (Manifest V3)

```
manifest.json (MV3)
  └─ content_scripts (world: MAIN)
       ├─ lib/pdf-lib.min.js   (injected first)
       ├─ lib/jszip.min.js     (injected second)
       ├─ content.js           (main logic)
       └─ panel.css            (styles)
```

Chrome's MV3 supports `"world": "MAIN"`, so libraries and content.js are injected directly into the page context.

### Firefox (Manifest V2)

```
manifest.json (MV2)
  └─ content_scripts
       ├─ loader.js            (runs in isolated sandbox)
       └─ panel.css            (styles)
```

Firefox content scripts run in an isolated sandbox. `loader.js` bridges this gap by injecting `<script>` tags for `pdf-lib.min.js`, `jszip.min.js`, and `content.js` into the page's MAIN world sequentially.

### Execution flow (both browsers)

```
Page load → scripts injected at document_idle
  → content.js waits for jQuery (from PESU page)
  → checks for #courselistunit
  → injects "PESUClaw" tab + floating panel
  → waits for user interaction
  → fetch → render → cache
```

---

## File overview

| File | Purpose |
|------|---------|
| `src/content.js` | Core logic: DOM injection, API calls, PDF merge, PPTX zip, caching, tab observer. |
| `src/panel.css` | All styles for the download panel. PESU-themed colors (#0091CD, #1d3756). |
| `src/popup.html` | Toolbar popup. Shows extension info and usage hint. |
| `src/lib/pdf-lib.min.js` | pdf-lib v1.17.1 — client-side PDF creation and merging. |
| `src/lib/jszip.min.js` | JSZip v3.10.1 — client-side ZIP file generation. |
| `platforms/chrome/manifest.json` | Chrome extension manifest (MV3). |
| `platforms/firefox/manifest.json` | Firefox extension manifest (MV2) with gecko settings. |
| `platforms/firefox/loader.js` | Injects scripts into page MAIN world via `<script>` tags. |

---

## API flow (3-step discovery)

PESU Academy doesn't expose direct download URLs on the page.

### Step 1 — Extract subject ID

```
DOM → #CourseContentId [onclick*="handleclasscoursecontentunit"]
  → regex match → subjectid
```

The `subjectid` is embedded in `onclick` attributes of elements inside the course content area.

### Step 2 — Get units

```
GET /Academy/a/i/getCourse/{subjectid}
  → returns HTML <option> elements
  → parsed into [{id, name}, ...]
```

Returns all units for the subject (e.g., "NLP Basics", "Prompt and RAG").

### Step 3 — Match active unit

The script reads the active tab text from `#courselistunit li.active a` and fuzzy-matches it against the unit list:

1. Exact substring match
2. Case-insensitive match
3. Word-overlap scoring (fuzzy)
4. Fallback to first unit

### Step 4 — Get classes

```
GET /Academy/a/i/getCourseClasses/{unitId}
  → returns HTML <option> elements
  → parsed into [{id, name}, ...]
```

Returns all classes (lectures/sessions) within the matched unit.

### Step 5 — Scan download links

For each class:

```
GET /Academy/s/studentProfilePESUAdmin
  ?controllerMode=6403
  &actionType=60
  &selectedData={subjectid}
  &id=2
  &unitid={classId}
  → returns HTML with download links
```

Two download patterns are extracted:

| Pattern | Type | Extraction |
|---------|------|------------|
| `downloadcoursedoc('uuid')` | Regular doc (PDF) | UUID → `/Academy/s/referenceMeterials/downloadcoursedoc/{uuid}` |
| `downloadslidecoursedoc` inside `loadIframe('url')` | Slide (PDF/PPTX) | Full URL from `loadIframe()` |

Deduplication via `Set` on IDs/URLs.

---

## Download and merge logic

### Magic byte detection

After fetching each file as `ArrayBuffer`, the script checks the first bytes:

| Bytes | Type | Action |
|-------|------|--------|
| `%PDF` (25 50 44 46) | PDF | Merge into combined PDF |
| `PK` (50 4B) | ZIP (PPTX/DOCX) | Add to PPTX ZIP bundle |
| Other | Unknown | Skip |

### PDF merging (pdf-lib)

```javascript
PDFDocument.create()                    // empty merged doc
PDFDocument.load(arrayBuf)              // load source PDF
mergedPdf.copyPages(src, indices)       // copy all pages
mergedPdf.addPage(page)                 // append
mergedPdf.save()                        // serialize → Blob → download
```

Output: `{UnitName}_Merged.pdf`

### PPTX zipping (JSZip)

```javascript
const zip = new JSZip();
pptxFiles.forEach(f => zip.file(f.name, f.data));
zip.generateAsync({ type: 'blob' });    // → download
```

Output: `{UnitName}_PPTX_files.zip`

Filename deduplication appends `(1)`, `(2)`, etc. for collisions.

---

## Caching

```javascript
const cache = {};                       // in-memory, per page session
cache[activeUnitText] = downloadItems;
```

- **Key**: Unit tab text (e.g., "NLP Basics, Pre-Trained Models")
- **Value**: Array of `{title, id, className, isSlideUrl?}` objects
- **Cache hit**: Skips all API calls, renders instantly with "cached" indicator
- **Force refresh**: Refetch button passes `force=true`, bypasses cache
- **Lifetime**: Lives in the content script closure — cleared on page reload

---

## Tab change detection

```javascript
new MutationObserver(callback)
  .observe(#courselistunit, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });
```

Watches for `class` attribute changes on unit tabs. When the active tab changes and the panel is visible, triggers `fetchAndRender()`.

---

## Server security notes

PESU Academy validates `Sec-Fetch-Dest` headers:

| Method | Sec-Fetch-Dest | Result |
|--------|---------------|--------|
| `<a>` click | `document` | Works |
| `fetch()` | `empty` | Works (with `credentials: 'same-origin'`) |
| `<iframe>` | `iframe` | 500 error |

The extension uses:
- `fetch()` with `credentials: 'same-origin'` for the merge/zip flow
- Hidden `<a download>` elements for individual file downloads

---

## Key variables

| Variable | Scope | Purpose |
|----------|-------|---------|
| `cache` | Closure | Download items cache per unit |
| `_fetching` | Closure | Lock flag — prevents concurrent fetches |
| `_lastRenderedTab` | Closure | Tracks which tab the panel was last rendered for |
| `_lastActiveTab` | Closure | Last active tab text for observer change detection |

---

## Development setup

1. Clone the repo
2. Run the build script:
   ```bash
   ./build.sh          # Linux/macOS
   .\build.ps1         # Windows
   ```
   This assembles `build/chrome/` and `build/firefox/` from shared source + platform overrides.
3. **Chrome**: `chrome://extensions` → Developer mode → **Load unpacked** → select `build/chrome`
4. **Firefox**: `about:debugging` → This Firefox → **Load Temporary Add-on** → select `build/firefox/manifest.json`
5. After editing files in `src/` or `platforms/`, re-run the build script
6. Chrome: click the refresh icon on the extension card. Firefox: click **Reload** in `about:debugging`
7. Reload the PESU Academy page to see changes

### Build targets

```bash
./build.sh           # both
./build.sh chrome    # chrome only
./build.sh firefox   # firefox only
```

### Debugging

- Open DevTools on the PESU Academy page
- Filter console by `[PESUClaw]` to see extension logs
- The content script runs in the page's main world (same as jQuery)
- Use the Sources tab → Content scripts → PESUClaw to set breakpoints

---

## Dependencies

| Library | Version | Size | Purpose | License |
|---------|---------|------|---------|---------|
| pdf-lib | 1.17.1 | ~525 KB | PDF merging | MIT |
| JSZip | 3.10.1 | ~98 KB | ZIP creation | MIT / GPLv3 |

Both are bundled locally in `src/lib/` — no CDN calls at runtime.
