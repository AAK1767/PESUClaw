// ClawdMate — Content Script
// Injected into pesuacademy.com/Academy/* pages

(function () {
  "use strict";

  // Prevent double-init
  if (window._clawdMateInitialized) return;
  window._clawdMateInitialized = true;

  // ─── Shared state (persists across SPA navigations) ───
  // cache structure: cache[unitText] = { '2': [items], '3': [items], ... }
  var cache = {};

  // ─── Bootstrap: watch for #courselistunit to appear/reappear ───
  function boot() {
    var bodyObserver = new MutationObserver(function () {
      var el = document.getElementById("courselistunit");
      var btn = document.getElementById("pesu-dl-tab-btn");
      // Re-inject whenever #courselistunit exists but our tab button doesn't
      if (el && !btn) {
        console.log(
          "[ClawdMate] #courselistunit found without tab button — injecting",
        );
        inject();
      }
    });

    bodyObserver.observe(document.body, { childList: true, subtree: true });

    // Also try immediately if already present
    if (
      document.getElementById("courselistunit") &&
      !document.getElementById("pesu-dl-tab-btn")
    ) {
      inject();
    }
  }

  function waitForJQuery(cb) {
    if (window.jQuery) return cb(window.jQuery);
    var t = setInterval(function () {
      if (window.jQuery) {
        clearInterval(t);
        cb(window.jQuery);
      }
    }, 200);
  }

  // ─── Main injection ───
  function inject() {
    waitForJQuery(function ($) {
      if (!$("#courselistunit").length) return;
      console.log("[ClawdMate] Injecting UI");

      // ─── State (per injection) ───
      var _fetching = false;
      var _lastRenderedTab = "";
      var _fetchVersion = 0;

      // Resource types (excluding AV Summary and Live Videos)
      var RESOURCE_TYPES = [
        { id: "2", label: "Slides" },
        { id: "3", label: "Notes" },
        { id: "5", label: "Assignments" },
        { id: "6", label: "QB" },
        { id: "7", label: "QA" },
      ];
      var selectedType = "2";

      // ─── Build DOM ───
      $("#pesu-dl-helper").remove();
      $("#pesu-dl-tab-btn").remove();

      // Tab button
      const navBtn = $(
        '<li id="pesu-dl-tab-btn"><a href="javascript:void(0)">ClawdMate</a></li>',
      );
      $("#courselistunit").append(navBtn);

      // Panel
      const container = $('<div id="pesu-dl-helper"></div>');
      const titleDiv = $('<div id="pesu-dl-title"></div>');
      const statusDiv = $('<div id="pesu-dl-status"></div>');

      const progressWrap = $('<div class="pesu-dl-progress-wrap"></div>');
      const progressBar = $('<div class="pesu-dl-progress-bar"></div>');
      progressWrap.append(progressBar);

      const contentArea = $('<div id="pesu-dl-content"></div>');

      const topBar = $('<div class="pesu-dl-topbar"></div>');
      const refetchBtn = $(
        '<button class="pesu-dl-btn-refresh" title="Refresh"></button>',
      ).html("&#8635;");
      const closeBtn = $('<button class="pesu-dl-btn-close"></button>').html(
        "&times;",
      );
      topBar.append(refetchBtn).append(closeBtn);

      // ─── Type toggle bar (single-select) ───
      var typeBar = $('<div class="pesu-dl-type-bar"></div>');
      RESOURCE_TYPES.forEach(function (rt) {
        var tbtn = $('<button class="pesu-dl-type-btn"></button>')
          .text(rt.label)
          .attr("data-type-id", rt.id);
        if (selectedType === rt.id) tbtn.addClass("selected");
        tbtn.on("click", function () {
          var tid = $(this).attr("data-type-id");
          if (tid === selectedType) return;
          selectedType = tid;
          typeBar.find(".pesu-dl-type-btn").removeClass("selected");
          $(this).addClass("selected");
          // Cancel any in-progress fetch
          if (_fetching) {
            _fetchVersion++;
            _fetching = false;
            refetchBtn.prop("disabled", false).css("opacity", 1);
          }
          if (container.is(":visible")) {
            renderOrFetch();
          }
        });
        typeBar.append(tbtn);
      });

      container
        .append(topBar)
        .append(typeBar)
        .append(titleDiv)
        .append(statusDiv)
        .append(progressWrap)
        .append(contentArea);
      closeBtn.on("click", function () {
        container.slideUp(200);
        navBtn.removeClass("active");
      });
      $("body").append(container);

      // ─── Render from cache or trigger fetch ───
      function renderOrFetch() {
        var activeUnitText = getActiveUnitText();
        var cachedUnit = cache[activeUnitText];
        if (!cachedUnit || !cachedUnit.hasOwnProperty(selectedType)) {
          fetchAndRender();
        } else {
          renderItems(activeUnitText, cachedUnit, true);
        }
      }

      // ─── Toggle panel ───
      navBtn.on("click", function () {
        if (container.is(":visible")) {
          container.slideUp(200);
          navBtn.removeClass("active");
        } else {
          container.slideDown(200);
          navBtn.addClass("active");
          var currentTab = getActiveUnitText();
          if (currentTab !== _lastRenderedTab) {
            _lastRenderedTab = currentTab;
            fetchAndRender();
          } else {
            renderOrFetch();
          }
        }
      });

      // ─── Get active unit text (excluding ClawdMate tab) ───
      function getActiveUnitText() {
        var texts = [];
        $("#courselistunit li.active a").each(function () {
          if ($(this).closest("#pesu-dl-tab-btn").length === 0) {
            texts.push($(this).text().trim());
          }
        });
        return (
          texts.join("") ||
          $("#courselistunit li.active a").first().text().trim()
        );
      }

      // ─── Render items for the selected type ───
      function renderItems(unitText, itemsByType, fromCache) {
        _lastRenderedTab = unitText;
        contentArea.empty();
        progressWrap.hide();

        var items = itemsByType[selectedType] || [];
        var totalCount = items.length;
        var typeLabel = "";
        for (var ri = 0; ri < RESOURCE_TYPES.length; ri++) {
          if (RESOURCE_TYPES[ri].id === selectedType) {
            typeLabel = RESOURCE_TYPES[ri].label;
            break;
          }
        }

        titleDiv.text(typeLabel + ": " + unitText + " (" + totalCount + ")");
        statusDiv.text(
          totalCount
            ? "Ready" + (fromCache ? " \u00b7 cached" : "")
            : "No files found for " + typeLabel,
        );

        if (!totalCount) return;

        console.log(
          "[ClawdMate] " +
            typeLabel +
            " " +
            unitText +
            " \u2014 " +
            totalCount +
            " files" +
            (fromCache ? " (cached)" : ""),
        );

        // Merge & Download button
        var dlAllBtn = $(
          '<button class="pesu-dl-merge-btn">Merge & Download ' +
            typeLabel +
            "</button>",
        );
        dlAllBtn.on("click", function () {
          mergeAndDownload(unitText, items, typeLabel, dlAllBtn);
        });
        contentArea.append(dlAllBtn);

        // Render items
        items.forEach(function (t, idx) {
          var displayTitle = t.title;
          // If title matches another item's title, append class name for clarity
          var dupeCount = items.filter(function (x) {
            return x.title === t.title;
          }).length;
          if (dupeCount > 1 && t.className && t.className !== t.title) {
            displayTitle = t.title + " [" + t.className + "]";
          }
          var btn = $(
            '<button class="pesu-dl-item" id="pesu-dl-item-' +
              idx +
              '"></button>',
          ).text(idx + 1 + ". " + displayTitle);

          btn.on("click", function () {
            var a = document.createElement("a");
            a.href = t.isSlideUrl
              ? t.id
              : "/Academy/s/referenceMeterials/downloadcoursedoc/" + t.id;
            a.download = "";
            a.style.display = "none";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            $(this)
              .addClass("done")
              .text(t.title + " \u2014 done");
          });

          contentArea.append(btn);
        });
      }

      // ─── Merge & download logic ───
      async function mergeAndDownload(unitText, items, typeName, btn) {
        if (!items.length) {
          statusDiv.text("Nothing to download");
          return;
        }
        btn.text("Downloading...").prop("disabled", true);
        progressWrap.show();

        var PDFDocument = PDFLib.PDFDocument;
        var safeName =
          unitText.replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "files";
        var mergedPdf = await PDFDocument.create();
        var pdfCount = 0,
          failed = 0;
        var pptxFiles = [];
        var usedNames = new Set();

        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          var url = item.isSlideUrl
            ? item.id
            : "/Academy/s/referenceMeterials/downloadcoursedoc/" + item.id;
          var pct = Math.round(((i + 1) / items.length) * 100);
          statusDiv.text(
            "Fetching " +
              typeName +
              " " +
              (i + 1) +
              "/" +
              items.length +
              ": " +
              item.title,
          );
          progressBar.css("width", pct + "%");

          try {
            var resp = await fetch(url, { credentials: "same-origin" });
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            var arrayBuf = await resp.arrayBuffer();
            var hdr = new Uint8Array(arrayBuf.slice(0, 5));
            var isPdf =
              hdr[0] === 0x25 &&
              hdr[1] === 0x50 &&
              hdr[2] === 0x44 &&
              hdr[3] === 0x46;
            var isZip = hdr[0] === 0x50 && hdr[1] === 0x4b;

            if (isPdf) {
              try {
                var srcPdf = await PDFDocument.load(arrayBuf, {
                  ignoreEncryption: true,
                });
                var pages = await mergedPdf.copyPages(
                  srcPdf,
                  srcPdf.getPageIndices(),
                );
                pages.forEach(function (p) {
                  mergedPdf.addPage(p);
                });
                pdfCount++;
                $("#pesu-dl-item-" + i)
                  .removeClass()
                  .addClass("pesu-dl-item merged")
                  .text(
                    item.title +
                      " \u2014 " +
                      srcPdf.getPageCount() +
                      "pg merged",
                  );
              } catch (e) {
                failed++;
                $("#pesu-dl-item-" + i)
                  .removeClass()
                  .addClass("pesu-dl-item failed")
                  .text(item.title + " \u2014 error");
              }
            } else if (isZip) {
              var filename = "";
              var cd = resp.headers.get("Content-Disposition");
              if (cd) {
                var m = cd.match(/filename\*?=(?:UTF-8''|["']?)([^;"'\n]+)/i);
                if (m) filename = decodeURIComponent(m[1].trim());
              }
              // Get extension from original filename or default
              var ext = "";
              if (filename) {
                var dotPos = filename.lastIndexOf(".");
                ext = dotPos > 0 ? filename.slice(dotPos) : ".pptx";
              } else {
                ext = ".pptx";
              }
              // Build name: (number)_title.ext
              var safeTitle = item.title.replace(/[/\\:*?"<>|]/g, "_").trim();
              var zipEntryName = i + 1 + "_" + safeTitle + ext;
              var finalName = zipEntryName,
                counter = 1;
              while (usedNames.has(finalName.toLowerCase())) {
                finalName =
                  i + 1 + "_" + safeTitle + " (" + counter + ")" + ext;
                counter++;
              }
              usedNames.add(finalName.toLowerCase());
              pptxFiles.push({ name: finalName, data: arrayBuf });
              $("#pesu-dl-item-" + i)
                .removeClass()
                .addClass("pesu-dl-item zipped")
                .text(item.title + " \u2014 zipped");
            } else {
              // Not PDF or ZIP — detect type from magic bytes / headers and add to ZIP bundle
              var otherFilename = "";
              var cd2 = resp.headers.get("Content-Disposition");
              if (cd2) {
                var m2 = cd2.match(/filename\*?=(?:UTF-8''|["']?)([^;"'\n]+)/i);
                if (m2) otherFilename = decodeURIComponent(m2[1].trim());
              }
              if (!otherFilename) {
                otherFilename = item.title.replace(/[/\\:*?"<>|]/g, "_");
                // Guess extension from magic bytes
                var isDOC =
                  hdr[0] === 0xd0 &&
                  hdr[1] === 0xcf &&
                  hdr[2] === 0x11 &&
                  hdr[3] === 0xe0;
                if (isDOC) otherFilename += ".doc";
                else otherFilename += ".bin";
              }
              // Extract extension and rebuild with (number)_title format
              var otherExt = "";
              var otherDotPos = otherFilename.lastIndexOf(".");
              otherExt =
                otherDotPos > 0 ? otherFilename.slice(otherDotPos) : ".bin";
              var safeOtherTitle = item.title
                .replace(/[/\\:*?"<>|]/g, "_")
                .trim();
              var otherEntryName = i + 1 + "_" + safeOtherTitle + otherExt;
              var otherFinal = otherEntryName,
                otherCounter = 1;
              while (usedNames.has(otherFinal.toLowerCase())) {
                otherFinal =
                  i +
                  1 +
                  "_" +
                  safeOtherTitle +
                  " (" +
                  otherCounter +
                  ")" +
                  otherExt;
                otherCounter++;
              }
              usedNames.add(otherFinal.toLowerCase());
              pptxFiles.push({ name: otherFinal, data: arrayBuf });
              $("#pesu-dl-item-" + i)
                .removeClass()
                .addClass("pesu-dl-item zipped")
                .text(
                  item.title +
                    " \u2014 zipped (" +
                    otherFinal.split(".").pop() +
                    ")",
                );
            }
          } catch (err) {
            failed++;
            $("#pesu-dl-item-" + i)
              .removeClass()
              .addClass("pesu-dl-item failed")
              .text(item.title + " \u2014 failed");
          }

          if (i < items.length - 1)
            await new Promise(function (r) {
              setTimeout(r, 200);
            });
        }

        var statusParts = [];

        if (pdfCount > 0) {
          statusDiv.text(
            "Saving " +
              typeName +
              " merged PDF (" +
              mergedPdf.getPageCount() +
              " pages)...",
          );
          var pdfBytes = await mergedPdf.save();
          var pdfBlob = new Blob([pdfBytes], { type: "application/pdf" });
          triggerDownload(pdfBlob, safeName + "_" + typeName + "_Merged.pdf");
          var sz = formatSize(pdfBlob.size);
          statusParts.push(
            pdfCount +
              " PDFs merged \u00b7 " +
              mergedPdf.getPageCount() +
              " pages \u00b7 " +
              sz,
          );
        }

        if (pptxFiles.length > 0) {
          statusDiv.text("Creating " + typeName + " ZIP...");
          await new Promise(function (r) {
            setTimeout(r, 500);
          });
          var zip = new JSZip();
          pptxFiles.forEach(function (f) {
            zip.file(f.name, f.data);
          });
          var zipBlob = await zip.generateAsync({ type: "blob" });
          triggerDownload(zipBlob, safeName + "_" + typeName + "_files.zip");
          var sz2 = formatSize(zipBlob.size);
          statusParts.push(pptxFiles.length + " files zipped \u00b7 " + sz2);
        }

        if (pdfCount === 0 && pptxFiles.length === 0) {
          btn.text("No files downloaded").css("background", "#c62828");
          statusDiv.text(
            "Could not process any files." +
              (failed ? " " + failed + " failed." : ""),
          );
        } else {
          btn.text("Done").css("background", "#2e7d32");
          statusDiv.html(
            statusParts.join("<br>") +
              (failed ? "<br>" + failed + " failed" : ""),
          );
        }
        progressWrap.hide();
      }

      // ─── Fetch & render ───
      async function fetchAndRender(force) {
        // Cancel previous fetch by bumping version
        _fetchVersion++;
        var myVersion = _fetchVersion;
        _fetching = false; // allow re-entry

        var activeUnitText = getActiveUnitText();

        // Initialize cache for this unit if needed
        if (!cache[activeUnitText]) cache[activeUnitText] = {};
        var cachedUnit = cache[activeUnitText];

        // Check if selected type is already cached
        if (!force && cachedUnit.hasOwnProperty(selectedType)) {
          console.log(
            "[ClawdMate] Cache hit: " +
              activeUnitText +
              " type=" +
              selectedType,
          );
          renderItems(activeUnitText, cachedUnit, true);
          return;
        }
        var typesToFetch = [selectedType];

        _fetching = true;
        refetchBtn.prop("disabled", true).css("opacity", 0.5);
        titleDiv.text("Loading " + activeUnitText + "...");
        statusDiv.text("Detecting subject...");
        contentArea.empty();
        progressWrap.show();
        progressBar.css("width", "5%");

        // Helper to check if this fetch is still current
        function isCancelled() {
          return _fetchVersion !== myVersion;
        }

        try {
          // Step 2-4: PESU now exposes course-content IDs directly in the page.
          // The old /getCourse endpoint returns 403, so don't use it.

          statusDiv.text("Detecting course content...");
          progressBar.css("width", "20%");

          var classes = [];
          var seenClassIds = new Set();
          var subjectid = null;

          $('#CourseContentId [onclick*="handleclasscoursecontentunit"]').each(
            function () {
              var onclick = $(this).attr("onclick") || "";

              var m = onclick.match(
                /handleclasscoursecontentunit\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/,
              );

              if (!m) return;

              var classId = m[1];
              var currentSubjectId = m[2];

              // Get subject ID from the first valid course-content entry
              if (!subjectid) {
                subjectid = currentSubjectId;
              }

              // Only use entries belonging to the current subject
              if (currentSubjectId !== subjectid) return;

              // Nested elements have the same onclick — deduplicate them
              if (seenClassIds.has(classId)) return;
              seenClassIds.add(classId);

              // Try to get a sensible title from the row
              var $row = $(this).closest("tr");

              var name = $row.length
                ? $row.find("td").first().text().trim()
                : $(this).text().trim();

              // Clean whitespace
              name = name.replace(/\s+/g, " ").trim();

              if (!name) {
                name = "Course Content " + (classes.length + 1);
              }

              classes.push({
                id: classId,
                name: name,
              });
            },
          );

          console.log(
            "[ClawdMate] Direct course content found:",
            classes.length,
            classes,
          );

          if (!classes.length) {
            statusDiv.text("No course content found");
            titleDiv.text("No content");
            _fetching = false;
            refetchBtn.prop("disabled", false).css("opacity", 1);
            progressWrap.hide();
            return;
          }

          if (isCancelled()) return;

          // Step 5: scan download links for each selected resource type
          var newItems = {};
          typesToFetch.forEach(function (tid) {
            newItems[tid] = [];
          });

          var totalSteps = classes.length * typesToFetch.length;
          var step = 0;

          for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            for (var ti = 0; ti < typesToFetch.length; ti++) {
              var typeId = typesToFetch[ti];
              var typeLabel = "";
              for (var ri = 0; ri < RESOURCE_TYPES.length; ri++) {
                if (RESOURCE_TYPES[ri].id === typeId) {
                  typeLabel = RESOURCE_TYPES[ri].label;
                  break;
                }
              }
              step++;
              var pct = 25 + Math.round((step / totalSteps) * 70);
              statusDiv.text(
                "Scanning " +
                  typeLabel +
                  " " +
                  (i + 1) +
                  "/" +
                  classes.length +
                  ": " +
                  cls.name,
              );
              progressBar.css("width", pct + "%");
              if (isCancelled()) {
                _fetching = false;
                return;
              }

              try {
                var response = await $.get(
                  "/Academy/s/studentProfilePESUAdmin",
                  {
                    url: "studentProfilePESUAdmin",
                    controllerMode: "6403",
                    actionType: "60",
                    selectedData: subjectid,
                    id: typeId,
                    unitid: cls.id,
                  },
                );
                if (typeof response === "string") {
                  var $html = $("<div>").html(response);
                  var itemsBefore = newItems[typeId].length;
                  // Pattern 1: onclick with downloadcoursedoc('id')
                  $html
                    .find('[onclick*="downloadcoursedoc"]')
                    .each(function () {
                      var onclick = $(this).attr("onclick") || "";
                      var m = onclick.match(/downloadcoursedoc\('([^']+)'\)/);
                      if (m) {
                        newItems[typeId].push({
                          title: $(this).text().trim() || cls.name,
                          id: m[1],
                          className: cls.name,
                          typeId: typeId,
                        });
                      }
                    });
                  // Pattern 2: onclick with downloadslidecoursedoc / loadIframe
                  $html
                    .find('[onclick*="downloadslidecoursedoc"]')
                    .each(function () {
                      var onclick = $(this).attr("onclick") || "";
                      var m = onclick.match(/loadIframe\('([^']+)'/);
                      if (m) {
                        var slideUrl = m[1].split("#")[0];
                        newItems[typeId].push({
                          title: $(this).text().trim() || cls.name,
                          id: slideUrl,
                          className: cls.name,
                          isSlideUrl: true,
                          typeId: typeId,
                        });
                      }
                    });
                  // Pattern 3: <a> tags with href containing downloadcoursedoc
                  $html.find('a[href*="downloadcoursedoc"]').each(function () {
                    var href = $(this).attr("href") || "";
                    var m = href.match(/downloadcoursedoc\/([^/?#]+)/);
                    if (m) {
                      newItems[typeId].push({
                        title: $(this).text().trim() || cls.name,
                        id: m[1],
                        className: cls.name,
                        typeId: typeId,
                      });
                    }
                  });
                  // Pattern 4: any onclick with download-related function calls (broad catch)
                  $html.find("[onclick]").each(function () {
                    var onclick = $(this).attr("onclick") || "";
                    if (
                      onclick.includes("downloadcoursedoc") ||
                      onclick.includes("downloadslidecoursedoc")
                    )
                      return;
                    var patterns = [
                      /download[A-Za-z]*\('([^']+)'\)/,
                      /downloadDoc\('([^']+)'\)/,
                      /downloadFile\('([^']+)'\)/,
                    ];
                    for (var pi = 0; pi < patterns.length; pi++) {
                      var m = onclick.match(patterns[pi]);
                      if (m) {
                        newItems[typeId].push({
                          title: $(this).text().trim() || cls.name,
                          id: m[1],
                          className: cls.name,
                          typeId: typeId,
                        });
                        break;
                      }
                    }
                  });
                  // Pattern 5: <a> tags with href containing referenceMeterials (PESU's spelling)
                  $html.find('a[href*="referenceMeterials"]').each(function () {
                    var href = $(this).attr("href") || "";
                    var m = href.match(/referenceMeterials\/[^/]+\/([^/?#]+)/);
                    if (m) {
                      newItems[typeId].push({
                        title: $(this).text().trim() || cls.name,
                        id: m[1],
                        className: cls.name,
                        typeId: typeId,
                      });
                    }
                  });
                  // Pattern 6: video <source> tags (for QA/QB video content)
                  $html.find("source[src], video[src]").each(function () {
                    var src = $(this).attr("src") || "";
                    if (src) {
                      newItems[typeId].push({
                        title: cls.name,
                        id: src,
                        className: cls.name,
                        isSlideUrl: true,
                        typeId: typeId,
                      });
                    }
                  });
                  // Pattern 7: video URLs in JavaScript (e.g. var videoSrc = '...')
                  var videoMatches = response.match(
                    /(?:src|videoSrc|videoUrl|source)\s*[:=]\s*['"]([^'"]+\.(?:mp4|webm|ogg|m3u8)[^'"]*)['"]/gi,
                  );
                  if (videoMatches) {
                    videoMatches.forEach(function (vm) {
                      var m2 = vm.match(/['"]([^'"]+)['"]\s*$/);
                      if (m2) {
                        newItems[typeId].push({
                          title: cls.name,
                          id: m2[1],
                          className: cls.name,
                          isSlideUrl: true,
                          typeId: typeId,
                        });
                      }
                    });
                  }
                  // Pattern 8: iframe src URLs
                  $html.find("iframe[src]").each(function () {
                    var src = $(this).attr("src") || "";
                    if (src && src.length > 5) {
                      newItems[typeId].push({
                        title: cls.name,
                        id: src,
                        className: cls.name,
                        isSlideUrl: true,
                        typeId: typeId,
                      });
                    }
                  });
                  var itemsFound = newItems[typeId].length - itemsBefore;
                  if (itemsFound > 0) {
                    console.log(
                      "[ClawdMate] Found " +
                        itemsFound +
                        " items for " +
                        typeLabel +
                        " class=" +
                        cls.name +
                        " (classId=" +
                        cls.id +
                        "). IDs: " +
                        newItems[typeId]
                          .slice(itemsBefore)
                          .map(function (it) {
                            return it.id;
                          })
                          .join(", "),
                    );
                  } else if (response.length > 100) {
                    console.log(
                      "[ClawdMate] DEBUG: No items for " +
                        typeLabel +
                        " class=" +
                        cls.name +
                        " (classId=" +
                        cls.id +
                        "). Response length=" +
                        response.length +
                        ". First 2000 chars:",
                      response.substring(0, 2000),
                    );
                  }
                }
              } catch (err) {
                console.warn(
                  "[ClawdMate] warn: " + cls.name + " (" + typeLabel + ")",
                  err.statusText || err,
                );
              }
              if (step < totalSteps)
                await new Promise(function (r) {
                  setTimeout(r, 300);
                });
              if (isCancelled()) {
                _fetching = false;
                return;
              }
            }
          }

          progressBar.css("width", "100%");
          progressWrap.hide();
          if (isCancelled()) {
            _fetching = false;
            return;
          }

          // Store in cache per type
          typesToFetch.forEach(function (tid) {
            cachedUnit[tid] = newItems[tid];
          });

          var totalCached = 0;
          Object.keys(cachedUnit).forEach(function (k) {
            totalCached += cachedUnit[k].length;
          });
          console.log(
            "[ClawdMate] Cached: " +
              activeUnitText +
              " (" +
              totalCached +
              " total items)",
          );
          renderItems(activeUnitText, cachedUnit, false);
        } catch (err) {
          console.error("[ClawdMate] Fetch error:", err);
          titleDiv.text("Error");
          statusDiv.text("Failed: " + (err.message || err));
          progressWrap.hide();
        }

        _fetching = false;
        refetchBtn.prop("disabled", false).css("opacity", 1);
      }

      // ─── Refetch ───
      refetchBtn.on("click", function () {
        fetchAndRender(true);
      });

      // ─── Tab change observer ───
      var _lastActiveTab = getActiveUnitText();
      var tabContainer = document.querySelector("#courselistunit");
      if (tabContainer) {
        var observer = new MutationObserver(function () {
          var newTab = getActiveUnitText();
          if (newTab && newTab !== _lastActiveTab) {
            console.log("[ClawdMate] Tab: " + _lastActiveTab + " -> " + newTab);
            _lastActiveTab = newTab;
            if (container.is(":visible")) {
              navBtn.addClass("active");
              fetchAndRender();
            }
          }
        });
        observer.observe(tabContainer, {
          subtree: true,
          attributes: true,
          attributeFilter: ["class"],
        });
      }

      console.log("[ClawdMate] Ready");

      // ─── Helpers ───
      function matchUnit(units, text) {
        var unit = null;
        for (var j = 0; j < units.length; j++) {
          var u = units[j];
          if (
            text.includes(u.name) ||
            u.name.includes(text) ||
            text.toLowerCase() === u.name.toLowerCase()
          ) {
            unit = u;
            break;
          }
        }
        if (!unit) {
          var words = text.toLowerCase().split(/\s+/);
          var best = 0;
          for (var k = 0; k < units.length; k++) {
            var uw = units[k].name.toLowerCase().split(/\s+/);
            var score = words.filter(function (w) {
              return uw.some(function (u2) {
                return u2.includes(w) || w.includes(u2);
              });
            }).length;
            if (score > best) {
              best = score;
              unit = units[k];
            }
          }
        }
        if (!unit && units.length > 0) unit = units[0];
        return unit;
      }

      function triggerDownload(blob, filename) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () {
          URL.revokeObjectURL(a.href);
        }, 10000);
      }

      function formatSize(bytes) {
        return bytes > 1024 * 1024
          ? (bytes / (1024 * 1024)).toFixed(1) + " MB"
          : (bytes / 1024).toFixed(0) + " KB";
      }
    }); // end waitForJQuery
  } // end inject

  // ─── Start ───
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
