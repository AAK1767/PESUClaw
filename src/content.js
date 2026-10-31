// PESUClaw — Content Script
// Injected into pesuacademy.com/Academy/* pages

(function () {
  "use strict";

  // Prevent double-init
  if (window._pesuClawInitialized) return;
  window._pesuClawInitialized = true;

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
          "[PESUClaw] #courselistunit found without tab button — injecting",
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
      console.log("[PESUClaw] Injecting UI");

      var PESUCLAW_VERSION = "1.3.0";
      var latestReleaseUrl =
        "https://api.github.com/repos/AAK1767/PESUClaw/releases/latest";
      var repoUrl = "https://github.com/AAK1767/PESUClaw";
      var releasePageUrl = repoUrl + "/releases/latest";
      // Fallback that avoids GitHub API rate limits (tags only, CORS-enabled)
      var jsdelivrTagsUrls = [
        "https://data.jsdelivr.com/v1/packages/gh/AAK1767/PESUClaw",
        "https://data.jsdelivr.com/v1/package/gh/AAK1767/PESUClaw",
      ];
      var updateCacheKey = "pesuclaw.latestRelease";
      var updateCacheTtl = 6 * 60 * 60 * 1000;
      var updateFailureTtl = 30 * 60 * 1000;

      // ─── State (per injection) ───
      var _fetching = false;
      var _lastRenderedTab = "";
      var _fetchVersion = 0;
      var _bulkRunning = false;
      var _bulkCancel = false;
      var unitLabels = {}; // unitKey -> display label (title or text of the tab)

      // Resource types (excluding AV Summary and Live Videos)
      var RESOURCE_TYPES = [
        { id: "2", label: "Slides" },
        { id: "3", label: "Notes" },
        { id: "5", label: "Assignments" },
        { id: "6", label: "QB" },
        { id: "7", label: "QA" },
      ];
      var selectedTypes = ["2"]; // several types can be selected at once

      // ─── Build DOM ───
      $("#pesu-dl-helper").remove();
      $("#pesu-dl-tab-btn").remove();

      // Tab button
      const navBtn = $(
        '<li id="pesu-dl-tab-btn"><a href="javascript:void(0)">PESUClaw</a></li>',
      );
      $("#courselistunit").append(navBtn);

      // Panel
      const container = $('<div id="pesu-dl-helper"></div>');
      const updateNotice = $('<div class="pesu-dl-update"></div>').hide();
      const titleDiv = $('<div id="pesu-dl-title"></div>');
      const statusDiv = $('<div id="pesu-dl-status"></div>');

      const progressWrap = $('<div class="pesu-dl-progress-wrap"></div>');
      const progressBar = $('<div class="pesu-dl-progress-bar"></div>');
      progressWrap.append(progressBar);
      const cancelBtn = $('<button class="pesu-dl-btn-cancel"></button>')
        .text("Cancel")
        .css({ margin: "6px 0", fontSize: "12px" })
        .hide()
        .on("click", function () {
          _bulkCancel = true;
          statusDiv.text("Cancelling...");
        });

      const contentArea = $('<div id="pesu-dl-content"></div>');

      // Footer: version + links to GitHub releases
      const footerStatus = $("<span></span>");
      const footer = $('<div class="pesu-dl-footer"></div>').css({
        marginTop: "12px",
        paddingTop: "8px",
        borderTop: "1px solid rgba(128,128,128,0.25)",
        fontSize: "11px",
        textAlign: "center",
        opacity: "0.75",
      });
      footer
        .append(document.createTextNode("PESUClaw v" + PESUCLAW_VERSION + " \u00b7 "))
        .append(
          $("<a>")
            .attr({ href: releasePageUrl, target: "_blank", rel: "noreferrer" })
            .text("Latest releases"),
        )
        .append(document.createTextNode(" \u00b7 "))
        .append(
          $("<a>")
            .attr({ href: repoUrl, target: "_blank", rel: "noreferrer" })
            .text("GitHub"),
        )
        .append(footerStatus);

      const topBar = $('<div class="pesu-dl-topbar"></div>');
      const refetchBtn = $(
        '<button class="pesu-dl-btn-refresh" title="Refresh"></button>',
      ).html("&#8635;");
      const closeBtn = $('<button class="pesu-dl-btn-close"></button>').html(
        "&times;",
      );
      topBar.append(refetchBtn).append(closeBtn);

      // ─── Type toggle bar (multi-select) ───
      var typeBar = $('<div class="pesu-dl-type-bar"></div>');
      RESOURCE_TYPES.forEach(function (rt) {
        var tbtn = $('<button class="pesu-dl-type-btn"></button>')
          .text(rt.label)
          .attr("data-type-id", rt.id)
          .attr("title", "Click to add or remove. Select several to download them together.");
        if (selectedTypes.indexOf(rt.id) >= 0) tbtn.addClass("selected");
        tbtn.on("click", function () {
          if (_bulkRunning) return;
          var tid = $(this).attr("data-type-id");
          var pos = selectedTypes.indexOf(tid);
          if (pos >= 0) {
            if (selectedTypes.length === 1) return; // keep at least one
            selectedTypes.splice(pos, 1);
            $(this).removeClass("selected");
          } else {
            selectedTypes.push(tid);
            $(this).addClass("selected");
          }
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
        .append(updateNotice)
        .append(titleDiv)
        .append(statusDiv)
        .append(progressWrap)
        .append(cancelBtn)
        .append(contentArea)
        .append(footer);
      closeBtn.on("click", function () {
        container.slideUp(200);
        navBtn.removeClass("active");
      });
      $("body").append(container);

      function compareVersions(left, right) {
        var leftParts = String(left)
          .replace(/^v/i, "")
          .split(".")
          .map(function (part) {
            return parseInt(part, 10) || 0;
          });
        var rightParts = String(right)
          .replace(/^v/i, "")
          .split(".")
          .map(function (part) {
            return parseInt(part, 10) || 0;
          });
        var length = Math.max(leftParts.length, rightParts.length);
        for (var index = 0; index < length; index++) {
          if ((leftParts[index] || 0) > (rightParts[index] || 0)) return 1;
          if ((leftParts[index] || 0) < (rightParts[index] || 0)) return -1;
        }
        return 0;
      }

      function fetchJson(url, timeoutMs) {
        var controller = new AbortController();
        var timer = setTimeout(function () {
          controller.abort();
        }, timeoutMs || 8000);
        // No custom headers on purpose: keeps it a simple CORS request.
        return fetch(url, { signal: controller.signal, cache: "no-store" })
          .then(function (response) {
            if (!response.ok) {
              throw new Error(url + " responded with " + response.status);
            }
            return response.json();
          })
          .finally(function () {
            clearTimeout(timer);
          });
      }

      async function fetchLatestRelease() {
        var errors = [];

        // 1) GitHub releases API
        try {
          var release = await fetchJson(latestReleaseUrl);
          if (release && (release.tag_name || release.name)) return release;
          errors.push("GitHub API returned no release");
        } catch (e) {
          errors.push(String(e && e.message ? e.message : e));
        }

        // 2) jsDelivr tag list (no GitHub rate limit)
        for (var i = 0; i < jsdelivrTagsUrls.length; i++) {
          try {
            var data = await fetchJson(jsdelivrTagsUrls[i]);
            var versions = (data && data.versions ? data.versions : [])
              .map(function (v) {
                return String(v && v.version ? v.version : v);
              })
              .filter(function (v) {
                return /^v?\d+(\.\d+)*$/.test(v);
              });
            if (versions.length) {
              versions.sort(compareVersions);
              var newest = versions[versions.length - 1];
              return {
                tag_name: newest,
                html_url: repoUrl + "/releases/tag/" + newest,
              };
            }
            errors.push("jsDelivr returned no tags");
          } catch (e2) {
            errors.push(String(e2 && e2.message ? e2.message : e2));
          }
        }

        throw new Error(errors.join(" | "));
      }

      function setUpdateCheckFailed(message) {
        footerStatus
          .text(" \u00b7 update check unavailable")
          .attr("title", message || "");
      }

      async function checkForUpdate() {
        try {
          var cachedUpdate = null;
          try {
            cachedUpdate = JSON.parse(
              localStorage.getItem(updateCacheKey) || "null",
            );
          } catch (e) {
            console.warn("[PESUClaw] Could not read update cache:", e);
          }
          if (cachedUpdate && cachedUpdate.checkedAt) {
            var age = Date.now() - cachedUpdate.checkedAt;
            if (cachedUpdate.release && age < updateCacheTtl) {
              showUpdateIfAvailable(cachedUpdate.release);
              return;
            }
            if (cachedUpdate.failed && age < updateFailureTtl) {
              setUpdateCheckFailed(cachedUpdate.message);
              return;
            }
          }

          var release = await fetchLatestRelease();
          try {
            localStorage.setItem(
              updateCacheKey,
              JSON.stringify({ checkedAt: Date.now(), release: release }),
            );
          } catch (e) {
            console.warn("[PESUClaw] Could not save update cache:", e);
          }
          showUpdateIfAvailable(release);
        } catch (error) {
          console.warn("[PESUClaw] Update check failed:", error);
          setUpdateCheckFailed(String(error && error.message ? error.message : error));
          try {
            localStorage.setItem(
              updateCacheKey,
              JSON.stringify({
                checkedAt: Date.now(),
                failed: true,
                message: String(error && error.message ? error.message : error),
              }),
            );
          } catch (e) {}
        }
      }

      function showUpdateIfAvailable(release) {
        var latestVersion = String(
          release.tag_name || release.name || "",
        ).replace(/^v/i, "");
        if (!latestVersion) return;
        if (compareVersions(latestVersion, PESUCLAW_VERSION) <= 0) {
          footerStatus.text(" \u00b7 up to date").attr("title", "");
          return;
        }
          updateNotice
            .empty()
            .append(
              $("<strong>").text(
                "New PESUClaw release v" + latestVersion + " available. ",
              ),
            )
            .append(
              $("<span>").text(
                "Download and install it to update the extension. ",
              ),
            )
            .append(
              $("<a>")
                .attr({
                  href: release.html_url || releasePageUrl,
                  target: "_blank",
                  rel: "noreferrer",
                })
                .text("Download update"),
            )
            .show();
      }

      checkForUpdate();

      // ─── Render from cache or trigger fetch ───
      function renderOrFetch() {
        var unitKey = getActiveUnitText();
        var cachedUnit = cache[unitKey];
        var missing =
          !cachedUnit ||
          selectedTypes.some(function (tid) {
            return !cachedUnit.hasOwnProperty(tid);
          });
        if (missing) {
          fetchAndRender();
        } else {
          renderItems(unitKey, cachedUnit, true);
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

      // ─── Get active unit text (excluding PESUClaw tab) ───
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

      // ─── Unit / selection helpers ───
      var UNIT_ROW_RE =
        /handleclasscoursecontentunit\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/;

      function sleep(ms) {
        return new Promise(function (resolve) {
          setTimeout(resolve, ms);
        });
      }

      function getSelectedTypeObjs() {
        return RESOURCE_TYPES.filter(function (rt) {
          return selectedTypes.indexOf(rt.id) >= 0;
        });
      }

      function isItemSelected(item) {
        return item.selected !== false;
      }

      function safeFileName(text, fallback) {
        return (
          String(text || "").replace(/[^a-zA-Z0-9 _-]/g, "").trim() ||
          fallback ||
          "files"
        );
      }

      function setItemState(item, cls, text) {
        if (!item || !item._uid) return;
        $("#" + item._uid)
          .removeClass()
          .addClass("pesu-dl-item " + cls)
          .text(text);
      }

      function isUnitAnchor(el) {
        return (
          $(el).closest("#pesu-dl-tab-btn").length === 0 &&
          /handleclassUnit\s*\(/.test($(el).attr("onclick") || "")
        );
      }

      function getUnitAnchors() {
        return $("#courselistunit li a").filter(function () {
          return isUnitAnchor(this);
        });
      }

      function getActiveUnitAnchor() {
        return $("#courselistunit li.active a")
          .filter(function () {
            return isUnitAnchor(this);
          })
          .first();
      }

      function parseUnitId($a) {
        var m = ($a.attr("onclick") || "").match(
          /handleclassUnit\s*\(\s*['"]([^'"]+)['"]/,
        );
        return m ? m[1] : null;
      }

      function getUnitLabel($a) {
        return $a.attr("title") || $a.text().trim();
      }

      function getActiveUnitId() {
        var $a = getActiveUnitAnchor();
        return $a.length ? parseUnitId($a) : null;
      }

      function countUnitRows(unitId) {
        var n = 0;
        $('#CourseContentId [onclick*="handleclasscoursecontentunit"]').each(
          function () {
            var m = ($(this).attr("onclick") || "").match(UNIT_ROW_RE);
            if (m && m[3] === unitId) n++;
          },
        );
        return n;
      }

      // PESU switches the active unit tab first and then updates
      // #CourseContentId asynchronously, so wait until the rows on screen
      // really belong to the unit we want.
      async function waitForUnitReady(unitId, isCancelled, maxAttempts) {
        for (var attempt = 0; attempt < maxAttempts; attempt++) {
          if (isCancelled()) return "cancelled";
          if (getActiveUnitId() === unitId && countUnitRows(unitId) > 0) {
            return "ready";
          }
          if (attempt === 0) {
            console.log("[PESUClaw] Waiting for PESU to update course content...");
          }
          await sleep(100);
        }
        return "timeout";
      }

      function collectClasses(unitId) {
        var classes = [];
        var seenClassIds = new Set();
        var subjectid = null;
        $('#CourseContentId [onclick*="handleclasscoursecontentunit"]').each(
          function () {
            var m = ($(this).attr("onclick") || "").match(UNIT_ROW_RE);
            if (!m) return;
            var classId = m[1];
            var currentSubjectId = m[2];
            var currentUnitId = m[3];
            // Ignore content from every other unit.
            if (currentUnitId !== unitId) return;
            if (!subjectid) subjectid = currentSubjectId;
            // Same UUID occurs several times (one link per resource type).
            if (seenClassIds.has(classId)) return;
            seenClassIds.add(classId);
            var $row = $(this).closest("tr");
            var name = $row.length
              ? $row.find("td").first().text().replace(/\s+/g, " ").trim()
              : $(this).text().replace(/\s+/g, " ").trim();
            if (!name) name = "Course Content " + (classes.length + 1);
            classes.push({
              id: classId,
              name: name,
              subjectId: currentSubjectId,
              unitId: currentUnitId,
            });
          },
        );
        return { subjectid: subjectid, classes: classes };
      }

      // ─── Render items for the selected types ───
      function renderItems(unitKey, cachedUnit, fromCache) {
        _lastRenderedTab = unitKey;
        var unitLabel = unitLabels[unitKey] || unitKey;
        contentArea.empty();
        progressWrap.hide();

        var types = getSelectedTypeObjs();
        var totalCount = 0;
        types.forEach(function (rt) {
          totalCount += (cachedUnit[rt.id] || []).length;
        });
        var typeNames = types
          .map(function (rt) {
            return rt.label;
          })
          .join(" + ");

        titleDiv.text(typeNames + ": " + unitLabel + " (" + totalCount + ")");
        statusDiv.text(
          totalCount
            ? "Ready" + (fromCache ? " \u00b7 cached" : "")
            : "No files found for " + typeNames,
        );

        console.log(
          "[PESUClaw] " + typeNames + " " + unitLabel + " \u2014 " + totalCount +
            " files" + (fromCache ? " (cached)" : ""),
        );

        // Bulk actions
        var bulkRow = $('<div class="pesu-dl-bulk-row"></div>').css({
          margin: "6px 0 10px",
        });
        if (types.length > 1 && totalCount > 0) {
          var multiBtn = $('<button class="pesu-dl-merge-btn pesu-dl-bulk-btn"></button>')
            .text("Download selected types (one ZIP)")
            .css({ marginBottom: "6px" });
          multiBtn.on("click", function () {
            runBulk("current", types, multiBtn);
          });
          bulkRow.append(multiBtn);
        }
        var allBtn = $('<button class="pesu-dl-merge-btn pesu-dl-bulk-btn"></button>')
          .text("Download all units (one ZIP)")
          .attr("title", "Visits every unit tab, then bundles the selected types per unit");
        allBtn.on("click", function () {
          runBulk("all", types, allBtn);
        });
        bulkRow.append(allBtn);
        contentArea.append(bulkRow);

        // One section per selected type
        types.forEach(function (rt) {
          var items = cachedUnit[rt.id] || [];
          var section = $('<div class="pesu-dl-section"></div>').css({
            marginTop: "10px",
          });
          var head = $('<div class="pesu-dl-section-head"></div>').css({
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontWeight: "600",
            margin: "4px 0",
          });
          head.append($("<span></span>").text(rt.label + " (" + items.length + ")"));
          section.append(head);

          if (!items.length) {
            section.append(
              $("<div></div>")
                .css({ fontSize: "12px", opacity: 0.7 })
                .text("No files found for " + rt.label),
            );
            contentArea.append(section);
            return;
          }

          var checkboxes = [];
          var mergeBtn = $('<button class="pesu-dl-merge-btn"></button>');

          function updateMergeLabel() {
            var n = items.filter(isItemSelected).length;
            mergeBtn
              .text(
                "Merge & Download " + rt.label +
                  (n === items.length ? "" : " (" + n + "/" + items.length + ")"),
              )
              .prop("disabled", n === 0);
          }

          function setAll(value) {
            items.forEach(function (t) {
              t.selected = value;
            });
            checkboxes.forEach(function ($cb) {
              $cb.prop("checked", value);
            });
            updateMergeLabel();
          }

          var linkCss = { cursor: "pointer", fontSize: "11px", fontWeight: "normal" };
          head.append(
            $("<span></span>")
              .append(
                $('<a href="javascript:void(0)">All</a>').css(linkCss).on("click", function () {
                  setAll(true);
                }),
              )
              .append(document.createTextNode(" / "))
              .append(
                $('<a href="javascript:void(0)">None</a>').css(linkCss).on("click", function () {
                  setAll(false);
                }),
              ),
          );

          mergeBtn.on("click", function () {
            mergeAndDownload(unitLabel, items.filter(isItemSelected), rt.label, mergeBtn);
          });
          section.append(mergeBtn);

          items.forEach(function (t, idx) {
            var displayTitle = t.title;
            // If title matches another item's title, append class name for clarity
            var dupeCount = items.filter(function (x) {
              return x.title === t.title;
            }).length;
            if (dupeCount > 1 && t.className && t.className !== t.title) {
              displayTitle = t.title + " [" + t.className + "]";
            }
            t._uid = "pesu-dl-item-" + rt.id + "-" + idx;

            var row = $('<div class="pesu-dl-row"></div>').css({
              display: "flex",
              alignItems: "center",
              gap: "6px",
            });
            var cb = $('<input type="checkbox">')
              .prop("checked", isItemSelected(t))
              .attr("title", "Include in Merge & Download")
              .css({ flex: "0 0 auto", margin: 0 });
            cb.on("change", function () {
              t.selected = this.checked;
              updateMergeLabel();
            });
            checkboxes.push(cb);

            var btn = $('<button class="pesu-dl-item" id="' + t._uid + '"></button>')
              .css({ flex: "1 1 auto", minWidth: 0 })
              .text(idx + 1 + ". " + displayTitle);

            btn.on("click", function () {
              var itemButton = $(this);
              itemButton.prop("disabled", true).text(t.title + " \u2014 fetching");
              downloadIndividualItem(t, idx)
                .then(function () {
                  itemButton
                    .prop("disabled", false)
                    .addClass("done")
                    .text(t.title + " \u2014 done");
                })
                .catch(function (error) {
                  console.error("[PESUClaw] Individual download failed:", error);
                  itemButton
                    .prop("disabled", false)
                    .addClass("failed")
                    .text(t.title + " \u2014 failed");
                });
            });

            row.append(cb).append(btn);
            section.append(row);
          });

          updateMergeLabel();
          contentArea.append(section);
        });
      }

      // ─── Merge & download logic ───
      function getResponseFilename(resp) {
        var contentDisposition = resp.headers.get("Content-Disposition") || "";
        var match = contentDisposition.match(
          /filename\*?=(?:UTF-8''|["']?)([^;"'\n]+)/i,
        );
        if (!match) return "";

        try {
          return decodeURIComponent(match[1].trim().replace(/^["']|["']$/g, ""));
        } catch (e) {
          return match[1].trim().replace(/^["']|["']$/g, "");
        }
      }

      function getFilenameExtension(filename) {
        var dotPos = filename.lastIndexOf(".");
        return dotPos > 0 ? filename.slice(dotPos).toLowerCase() : "";
      }

      function isArchiveExtension(extension) {
        return [".zip", ".rar", ".7z", ".tar", ".gz", ".tgz"].indexOf(
          extension,
        ) >= 0;
      }

      function getArchiveExtension(header, filename, title) {
        var filenameExt = getFilenameExtension(filename);
        var titleExt = getFilenameExtension(title);
        var isZip = header[0] === 0x50 && header[1] === 0x4b;
        var isRar =
          header[0] === 0x52 &&
          header[1] === 0x61 &&
          header[2] === 0x72 &&
          header[3] === 0x21 &&
          header[4] === 0x1a;
        var is7z =
          header[0] === 0x37 &&
          header[1] === 0x7a &&
          header[2] === 0xbc &&
          header[3] === 0xaf &&
          header[4] === 0x27;
        var isGzip = header[0] === 0x1f && header[1] === 0x8b;
        var isTar =
          header.length >= 262 &&
          header[257] === 0x75 &&
          header[258] === 0x73 &&
          header[259] === 0x74 &&
          header[260] === 0x61 &&
          header[261] === 0x72;

        if (isArchiveExtension(filenameExt)) return filenameExt;
        if (isArchiveExtension(titleExt)) return titleExt;
        if (isZip) return ".zip";
        if (isRar) return ".rar";
        if (is7z) return ".7z";
        if (isGzip) return ".gz";
        if (isTar) return ".tar";
        return "";
      }

      async function getOfficeExtensionFromFile(
        arrayBuf,
        filename,
        title,
        contentType,
      ) {
        var filenameExtension = getOfficeExtension(filename);
        if (filenameExtension) return filenameExtension;

        var titleExtension = getOfficeExtension(title);
        if (titleExtension) return titleExtension;

        var mime = String(contentType || "").toLowerCase().split(";")[0].trim();
        if (
          mime === "application/msword" ||
          mime === "application/vnd.ms-word"
        ) {
          return ".doc";
        }
        if (
          mime ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ) {
          return ".docx";
        }
        if (
          mime ===
          "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        ) {
          return ".pptx";
        }

        if (
          mime ===
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ) {
          return ".xlsx";
        }

        return sniffContainerExtension(arrayBuf);
      }

      // Detects Office / OpenDocument / EPUB files from their raw bytes.
      // ZIP stores entry names uncompressed, so no JSZip is needed, and it
      // also works for templates/slideshows (.dotx, .ppsx) and odd writers.
      function sniffContainerExtension(arrayBuf) {
        try {
          var h = new Uint8Array(arrayBuf.slice(0, 8));
          var isPK = h[0] === 0x50 && h[1] === 0x4b;
          var isOLE =
            h[0] === 0xd0 && h[1] === 0xcf && h[2] === 0x11 && h[3] === 0xe0;

          if (isPK) {
            var text = new TextDecoder("latin1").decode(
              new Uint8Array(arrayBuf),
            );
            if (text.indexOf("word/document.xml") >= 0) return ".docx";
            if (text.indexOf("ppt/presentation.xml") >= 0) return ".pptx";
            if (text.indexOf("xl/workbook.xml") >= 0) return ".xlsx";
            if (text.indexOf("application/vnd.oasis.opendocument.text") >= 0)
              return ".odt";
            if (
              text.indexOf("application/vnd.oasis.opendocument.presentation") >= 0
            )
              return ".odp";
            if (
              text.indexOf("application/vnd.oasis.opendocument.spreadsheet") >= 0
            )
              return ".ods";
            if (text.indexOf("application/epub+zip") >= 0) return ".epub";
            return "";
          }

          if (isOLE) {
            var len = arrayBuf.byteLength - (arrayBuf.byteLength % 2);
            var wide = new TextDecoder("utf-16le").decode(
              new Uint8Array(arrayBuf, 0, len),
            );
            if (wide.indexOf("PowerPoint Document") >= 0) return ".ppt";
            if (wide.indexOf("WordDocument") >= 0) return ".doc";
            if (
              wide.indexOf("Workbook") >= 0 ||
              wide.indexOf("Book") >= 0
            )
              return ".xls";
          }
        } catch (error) {
          console.warn("[PESUClaw] Could not sniff file type:", error);
        }
        return "";
      }

      function getGeneratedDownloadName(index, title, extension) {
        var safeTitle =
          title.replace(/[/\\:*?"<>|]/g, "_").trim() || "file";
        var safeExtension = extension || getFilenameExtension(title) || ".bin";
        if (safeTitle.toLowerCase().endsWith(safeExtension)) {
          safeTitle = safeTitle.slice(0, -safeExtension.length).trim() || "file";
        }
        return index + 1 + "_" + safeTitle + safeExtension;
      }

      async function downloadIndividualItem(item, index) {
        var url = item.isSlideUrl
          ? item.id
          : "/Academy/s/referenceMeterials/downloadcoursedoc/" + item.id;
        var response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        var arrayBuf = await response.arrayBuffer();
        var header = new Uint8Array(arrayBuf.slice(0, 512));
        var responseFilename = getResponseFilename(response);
        var officeExtension = await getOfficeExtensionFromFile(
          arrayBuf,
          responseFilename,
          item.title,
          response.headers.get("Content-Type"),
        );
        var extension = officeExtension ||
          getPreservedExtension(responseFilename, item.title) ||
          getArchiveExtension(header, responseFilename, item.title);
        if (!extension) {
          extension =
            header[0] === 0x25 &&
            header[1] === 0x50 &&
            header[2] === 0x44 &&
            header[3] === 0x46
              ? ".pdf"
              : ".bin";
        }
        triggerDownload(
          new Blob([arrayBuf], {
            type: response.headers.get("Content-Type") || "application/octet-stream",
          }),
          getGeneratedDownloadName(index, item.title, extension),
        );
      }

      var KNOWN_TITLE_EXTENSIONS = [
        ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".csv",
        ".txt", ".rtf", ".odt", ".odp", ".ods", ".epub", ".png", ".jpg",
        ".jpeg", ".gif", ".svg", ".mp4", ".mp3", ".py", ".java", ".c",
        ".cpp", ".js", ".html", ".json", ".xml", ".md", ".ipynb", ".sql",
      ];

      // Returns the file's real (non-archive) extension from the server
      // filename or the title, or "" if none can be trusted.
      function getPreservedExtension(filename, title) {
        var fnExt = getFilenameExtension(filename || "");
        if (/^\.[a-z][a-z0-9]{0,5}$/.test(fnExt) && !isArchiveExtension(fnExt)) {
          return fnExt;
        }
        var titleExt = getFilenameExtension(title || "");
        if (KNOWN_TITLE_EXTENSIONS.indexOf(titleExt) >= 0) return titleExt;
        return "";
      }

      function getOfficeExtension(filename) {
        var extension = getFilenameExtension(filename);
        return extension === ".doc" ||
          extension === ".docx" ||
          extension === ".ppt" ||
          extension === ".pptx"
          ? extension
          : "";
      }

      // groups: [{ output: "path/inside/bundle.pdf", files: ["relative/path.docx", ...] }]
      function createOfficeMergeScript(groups) {
        var template = String.raw`#!/usr/bin/env python3
"""Convert the bundled Office files to PDF and merge them (with bookmarks).

Uses LibreOffice when available. On Windows, Microsoft Word/PowerPoint can be
used instead (requires desktop Microsoft Office and pywin32).
Run the included launcher, or:  python -m pip install -r requirements.txt
"""
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile

try:
    from pypdf import PdfWriter
except ImportError:
    sys.exit('Missing PDF package. Run "python -m pip install pypdf".')

# Each group becomes one merged PDF (paths are relative to this script).
GROUPS = __GROUPS__


def convert_with_libreoffice(source, output_dir, soffice):
    subprocess.run(
        [soffice, '--headless', '--convert-to', 'pdf', '--outdir', str(output_dir), str(source)],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return output_dir / (source.stem + '.pdf')


def convert_with_microsoft_office(source, output_dir):
    try:
        import win32com.client
    except ImportError:
        sys.exit('Microsoft Office fallback needs pywin32. Run "python -m pip install pywin32", then retry.')

    output = output_dir / (source.stem + '.pdf')
    extension = source.suffix.lower()
    if extension in ('.doc', '.docx'):
        word = win32com.client.DispatchEx('Word.Application')
        document = None
        try:
            word.Visible = False
            document = word.Documents.Open(str(source), ReadOnly=True, AddToRecentFiles=False)
            document.ExportAsFixedFormat(str(output), 17)
        finally:
            if document is not None:
                document.Close(False)
            word.Quit()
    elif extension in ('.ppt', '.pptx'):
        powerpoint = win32com.client.DispatchEx('PowerPoint.Application')
        presentation = None
        try:
            presentation = powerpoint.Presentations.Open(str(source), WithWindow=False, ReadOnly=True)
            presentation.SaveAs(str(output), 32)
        finally:
            if presentation is not None:
                presentation.Close()
            powerpoint.Quit()
    else:
        sys.exit(f'Unsupported Office file: {source.name}')
    return output


def bookmark_title(file_name):
    stem = Path(file_name).stem
    return re.sub(r'^\d+_', '', stem) or stem


def main():
    soffice = shutil.which('soffice') or shutil.which('libreoffice')
    use_microsoft_office = not soffice and platform.system() == 'Windows'
    if not soffice and not use_microsoft_office:
        sys.exit('No converter found. Install LibreOffice, or run this on Windows with desktop Microsoft Office and pywin32.')

    bundle_dir = Path(__file__).resolve().parent
    total_files = 0
    with tempfile.TemporaryDirectory(prefix='pesuclaw-') as temp_dir:
        temp_root = Path(temp_dir)
        for group_number, group in enumerate(GROUPS, start=1):
            converted = []
            for index, file_name in enumerate(group['files'], start=1):
                source = bundle_dir / file_name
                if not source.is_file():
                    sys.exit(f'Missing bundled file: {file_name}')
                file_temp_dir = temp_root / f'{group_number}_{index}'
                file_temp_dir.mkdir()
                print(f'Converting {file_name} ...')
                if soffice:
                    pdf_path = convert_with_libreoffice(source, file_temp_dir, soffice)
                else:
                    pdf_path = convert_with_microsoft_office(source, file_temp_dir)
                if not pdf_path.is_file():
                    sys.exit(f'Office converter did not create a PDF for: {file_name}')
                converted.append((file_name, pdf_path))

            writer = PdfWriter()
            try:
                for file_name, pdf_path in converted:
                    writer.append(str(pdf_path), outline_item=bookmark_title(file_name))
                output_path = bundle_dir / group['output']
                output_path.parent.mkdir(parents=True, exist_ok=True)
                with open(output_path, 'wb') as handle:
                    writer.write(handle)
            finally:
                writer.close()
            print(f"Created {group['output']} from {len(converted)} file(s).")
            total_files += len(converted)

    print(f'Done: {total_files} Office file(s) merged into {len(GROUPS)} PDF(s).')


if __name__ == '__main__':
    main()
`;
        return template.replace("__GROUPS__", function () {
          return JSON.stringify(groups, null, 4);
        });
      }

      function createOfficeRequirements() {
        return ["pypdf>=4.0", "pywin32; platform_system == 'Windows'", ""].join(
          "\n",
        );
      }

      function createWindowsMergeLauncher() {
        return [
          "@echo off",
          "setlocal",
          "py -m pip install -r requirements.txt",
          "if errorlevel 1 python -m pip install -r requirements.txt",
          "if errorlevel 1 (",
          "  pause",
          "  exit /b 1",
          ")",
          "py merge_office_files.py",
          "if errorlevel 1 python merge_office_files.py",
          "pause",
          "",
        ].join("\r\n");
      }

      function createUnixMergeLauncher() {
        return [
          "#!/usr/bin/env sh",
          "set -eu",
          "python3 -m pip install -r requirements.txt",
          "python3 merge_office_files.py",
          "",
        ].join("\n");
      }

      // ─── PDF bookmarks (one outline entry per merged source file) ───
      function addPdfOutline(mergedPdf, entries) {
        var P = PDFLib;
        var valid = entries.filter(function (e) {
          return e && typeof e.pageIndex === "number";
        });
        if (!valid.length) return;
        var ctx = mergedPdf.context;
        var pages = mergedPdf.getPages();
        var outlinesRef = ctx.nextRef();
        var refs = valid.map(function () {
          return ctx.nextRef();
        });
        valid.forEach(function (e, i) {
          var page = pages[Math.min(e.pageIndex, pages.length - 1)];
          var dict = ctx.obj({
            Title: P.PDFHexString.fromText(String(e.title || "Untitled").slice(0, 200)),
            Parent: outlinesRef,
            Dest: [page.ref, P.PDFName.of("Fit")],
          });
          if (i > 0) dict.set(P.PDFName.of("Prev"), refs[i - 1]);
          if (i < valid.length - 1) dict.set(P.PDFName.of("Next"), refs[i + 1]);
          ctx.assign(refs[i], dict);
        });
        ctx.assign(
          outlinesRef,
          ctx.obj({
            Type: "Outlines",
            First: refs[0],
            Last: refs[refs.length - 1],
            Count: valid.length,
          }),
        );
        mergedPdf.catalog.set(P.PDFName.of("Outlines"), outlinesRef);
        mergedPdf.catalog.set(P.PDFName.of("PageMode"), P.PDFName.of("UseOutlines"));
      }

      // Fetches every item, merges the PDFs (with bookmarks) and collects the
      // non-PDF files. Pure data in / data out so it serves both the single
      // "Merge & Download" button and the bulk ZIP downloads.
      // opts: { shouldCancel(): bool, onProgress(i, total, item) }
      async function processItems(items, typeName, opts) {
        opts = opts || {};
        var PDFDocument = PDFLib.PDFDocument;
        var mergedPdf = await PDFDocument.create();
        var res = {
          mergedPdf: mergedPdf,
          pdfCount: 0,
          failed: 0,
          cancelled: false,
          otherFiles: [],
          officeFiles: [],
          archiveCount: 0,
          outline: [],
        };
        var usedNames = new Set();
        var titleCounts = {};
        items.forEach(function (it) {
          titleCounts[it.title] = (titleCounts[it.title] || 0) + 1;
        });

        function addOtherFile(item, index, ext, arrayBuf) {
          var safeTitle = item.title.replace(/[/\\:*?"<>|]/g, "_").trim() || "file";
          if (safeTitle.toLowerCase().endsWith(ext)) {
            safeTitle = safeTitle.slice(0, -ext.length).trim() || "file";
          }
          var finalName = index + 1 + "_" + safeTitle + ext;
          var counter = 1;
          while (usedNames.has(finalName.toLowerCase())) {
            finalName = index + 1 + "_" + safeTitle + " (" + counter + ")" + ext;
            counter++;
          }
          usedNames.add(finalName.toLowerCase());
          res.otherFiles.push({ name: finalName, data: arrayBuf });
          if (getOfficeExtension(finalName)) res.officeFiles.push(finalName);
          return finalName;
        }

        for (var i = 0; i < items.length; i++) {
          if (opts.shouldCancel && opts.shouldCancel()) {
            res.cancelled = true;
            break;
          }
          var item = items[i];
          var url = item.isSlideUrl
            ? item.id
            : "/Academy/s/referenceMeterials/downloadcoursedoc/" + item.id;
          if (opts.onProgress) opts.onProgress(i, items.length, item);

          try {
            var resp = await fetch(url, { credentials: "same-origin" });
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            var arrayBuf = await resp.arrayBuffer();
            var hdr = new Uint8Array(arrayBuf.slice(0, 512));
            var isPdf =
              hdr[0] === 0x25 && hdr[1] === 0x50 && hdr[2] === 0x44 && hdr[3] === 0x46;
            var responseFilename = getResponseFilename(resp);
            var officeExtension = await getOfficeExtensionFromFile(
              arrayBuf,
              responseFilename,
              item.title,
              resp.headers.get("Content-Type"),
            );
            var preservedExt =
              officeExtension || getPreservedExtension(responseFilename, item.title);
            var archiveExt = preservedExt
              ? ""
              : getArchiveExtension(hdr, responseFilename, item.title);

            if (archiveExt === ".zip" && !isPdf) {
              console.warn(
                "[PESUClaw] Treating as ZIP:",
                item.title,
                "| filename:",
                responseFilename,
                "| type:",
                resp.headers.get("Content-Type"),
              );
            }

            if (isPdf) {
              try {
                var srcPdf = await PDFDocument.load(arrayBuf, { ignoreEncryption: true });
                var startPage = mergedPdf.getPageCount();
                var pages = await mergedPdf.copyPages(srcPdf, srcPdf.getPageIndices());
                pages.forEach(function (p) {
                  mergedPdf.addPage(p);
                });
                res.outline.push({
                  title:
                    titleCounts[item.title] > 1 &&
                    item.className &&
                    item.className !== item.title
                      ? item.title + " [" + item.className + "]"
                      : item.title,
                  pageIndex: startPage,
                });
                res.pdfCount++;
                setItemState(
                  item,
                  "merged",
                  item.title + " \u2014 " + srcPdf.getPageCount() + "pg merged",
                );
              } catch (e) {
                res.failed++;
                setItemState(item, "failed", item.title + " \u2014 error");
              }
            } else {
              var ext = preservedExt || archiveExt;
              if (!ext) {
                var isOLE =
                  hdr[0] === 0xd0 && hdr[1] === 0xcf && hdr[2] === 0x11 && hdr[3] === 0xe0;
                ext = isOLE ? ".doc" : ".bin";
              }
              if (isArchiveExtension(ext)) res.archiveCount++;
              var finalName = addOtherFile(item, i, ext, arrayBuf);
              setItemState(
                item,
                "zipped",
                item.title + " \u2014 zipped (" + finalName.split(".").pop() + ")",
              );
            }
          } catch (err) {
            res.failed++;
            setItemState(item, "failed", item.title + " \u2014 failed");
          }

          if (i < items.length - 1) await sleep(200);
        }

        if (res.pdfCount >= 2) addPdfOutline(mergedPdf, res.outline);
        return res;
      }

      // Adds a processed result to a JSZip. `folder` is "" or "A/B/".
      async function packResult(zip, folder, baseName, typeLabel, res, groups, totals) {
        if (res.pdfCount > 0) {
          var bytes = await res.mergedPdf.save();
          zip.file(folder + baseName + "_" + typeLabel + "_Merged.pdf", bytes);
          totals.pdfs += res.pdfCount;
          totals.pages += res.mergedPdf.getPageCount();
        }
        if (res.otherFiles.length > 0) {
          var filesFolder = folder + "files/";
          res.otherFiles.forEach(function (f) {
            zip.file(filesFolder + f.name, f.data);
          });
          totals.others += res.otherFiles.length;
          if (res.officeFiles.length > 0) {
            groups.push({
              output: folder + baseName + "_" + typeLabel + "_Office_Merged.pdf",
              files: res.officeFiles.map(function (n) {
                return filesFolder + n;
              }),
            });
          }
        }
        totals.failed += res.failed;
      }

      function addMergeHelpers(zip, groups) {
        if (!groups.length) return;
        zip.file("merge_office_files.py", createOfficeMergeScript(groups));
        zip.file("requirements.txt", createOfficeRequirements());
        zip.file("run_merge_windows.bat", createWindowsMergeLauncher());
        zip.file("run_merge_linux.sh", createUnixMergeLauncher());
      }

      // ─── Single type: merged PDF + ZIP of the other files ───
      async function mergeAndDownload(unitText, items, typeName, btn) {
        if (!items.length) {
          statusDiv.text("Nothing selected to download");
          return;
        }
        btn.text("Downloading...").prop("disabled", true);
        progressWrap.show();

        var safeName = safeFileName(unitText, "files");
        var statusParts = [];
        try {
          var res = await processItems(items, typeName, {
            onProgress: function (i, n, item) {
              statusDiv.text(
                "Fetching " + typeName + " " + (i + 1) + "/" + n + ": " + item.title,
              );
              progressBar.css("width", Math.round(((i + 1) / n) * 100) + "%");
            },
          });

          if (res.pdfCount > 0) {
            statusDiv.text(
              "Saving " + typeName + " merged PDF (" + res.mergedPdf.getPageCount() + " pages)...",
            );
            var pdfBytes = await res.mergedPdf.save();
            var pdfBlob = new Blob([pdfBytes], { type: "application/pdf" });
            triggerDownload(pdfBlob, safeName + "_" + typeName + "_Merged.pdf");
            statusParts.push(
              res.pdfCount + " PDFs merged \u00b7 " + res.mergedPdf.getPageCount() +
                " pages \u00b7 " + formatSize(pdfBlob.size),
            );
          }

          if (res.otherFiles.length > 0) {
            statusDiv.text("Creating " + typeName + " ZIP...");
            await sleep(500);
            var zip = new JSZip();
            res.otherFiles.forEach(function (f) {
              zip.file(f.name, f.data);
            });
            addMergeHelpers(
              zip,
              res.officeFiles.length
                ? [
                    {
                      output: safeName + "_" + typeName + "_Office_Merged.pdf",
                      files: res.officeFiles,
                    },
                  ]
                : [],
            );
            var zipBlob = await zip.generateAsync({ type: "blob" });
            triggerDownload(zipBlob, safeName + "_" + typeName + "_files.zip");
            statusParts.push(
              res.otherFiles.length + " files zipped" +
                (res.officeFiles.length ? " \u00b7 merge_office_files.py included" : "") +
                " \u00b7 " + formatSize(zipBlob.size),
            );
          }

          if (res.pdfCount > 0 || res.otherFiles.length > 0) {
            statusParts.unshift(
              items.length - res.failed + " processed \u00b7 " + res.pdfCount +
                " PDFs merged \u00b7 " + (res.otherFiles.length - res.archiveCount) +
                " Office/other files \u00b7 " + res.archiveCount + " archives",
            );
          }

          if (res.pdfCount === 0 && res.otherFiles.length === 0) {
            btn.text("No files downloaded").css("background", "#c62828");
            statusDiv.text(
              "Could not process any files." + (res.failed ? " " + res.failed + " failed." : ""),
            );
          } else {
            btn.text("Done").css("background", "#2e7d32");
            statusDiv.html(
              statusParts.join("<br>") + (res.failed ? "<br>" + res.failed + " failed" : ""),
            );
          }
        } catch (err) {
          console.error("[PESUClaw] Merge failed:", err);
          btn.text("Failed \u2014 retry").prop("disabled", false).css("background", "#c62828");
          statusDiv.text("Failed: " + (err && err.message ? err.message : err));
        }
        progressWrap.hide();
      }

      // ─── Bulk: selected types of this unit, or every unit, in one ZIP ───
      // mode: "current" | "all"
      async function runBulk(mode, types, btn) {
        if (_bulkRunning || !types.length) return;
        _bulkRunning = true;
        _bulkCancel = false;
        _fetchVersion++; // cancel any in-flight scan
        _fetching = false;

        var $startAnchor = getActiveUnitAnchor();
        var startUnitId = $startAnchor.length ? parseUnitId($startAnchor) : null;

        var units = [];
        if (mode === "all") {
          getUnitAnchors().each(function () {
            var id = parseUnitId($(this));
            if (
              id &&
              !units.some(function (u) {
                return u.id === id;
              })
            ) {
              units.push({ id: id, el: this, label: getUnitLabel($(this)) });
            }
          });
        } else if ($startAnchor.length && startUnitId) {
          units.push({
            id: startUnitId,
            el: $startAnchor[0],
            label: getUnitLabel($startAnchor),
          });
        }
        if (!units.length) {
          statusDiv.text("Could not find any units");
          _bulkRunning = false;
          return;
        }

        var multiUnit = units.length > 1;
        var typesLabel = types
          .map(function (rt) {
            return rt.label;
          })
          .join("-");
        var zip = new JSZip();
        var groups = [];
        var totals = { pdfs: 0, pages: 0, others: 0, failed: 0 };
        var skippedUnits = [];
        var summaryLines = [];

        $(".pesu-dl-bulk-btn, .pesu-dl-merge-btn, .pesu-dl-item").prop("disabled", true);
        refetchBtn.prop("disabled", true).css("opacity", 0.5);
        btn.text("Working...");
        cancelBtn.show();
        progressWrap.show();
        progressBar.css("width", "2%");

        function cancelled() {
          return _bulkCancel;
        }
        function overall(unitIndex, fraction) {
          return Math.max(2, Math.round(((unitIndex + fraction) / units.length) * 100));
        }

        try {
          for (var ui = 0; ui < units.length; ui++) {
            if (_bulkCancel) break;
            var u = units[ui];
            var prefix = multiUnit ? "Unit " + (ui + 1) + "/" + units.length + " (" + u.label + "): " : "";

            statusDiv.text(prefix + "opening...");
            progressBar.css("width", overall(ui, 0) + "%");
            if (getActiveUnitId() !== u.id) u.el.click();
            var ready = await waitForUnitReady(u.id, cancelled, multiUnit ? 80 : 50);
            if (ready === "cancelled") break;
            if (ready !== "ready") {
              skippedUnits.push(u.label);
              continue;
            }

            var unitKey = getActiveUnitText();
            unitLabels[unitKey] = u.label;
            if (!cache[unitKey]) cache[unitKey] = {};
            var cachedUnit = cache[unitKey];
            var collected = collectClasses(u.id);

            // Scan whatever hasn't been scanned yet for the chosen types
            var missingTypes = types.filter(function (rt) {
              return !cachedUnit.hasOwnProperty(rt.id);
            });
            if (missingTypes.length && collected.subjectid && collected.classes.length) {
              var scanned = {};
              missingTypes.forEach(function (rt) {
                scanned[rt.id] = [];
              });
              var totalSteps = collected.classes.length * missingTypes.length;
              var step = 0;
              for (var ci = 0; ci < collected.classes.length && !_bulkCancel; ci++) {
                for (var mi = 0; mi < missingTypes.length && !_bulkCancel; mi++) {
                  var cls = collected.classes[ci];
                  var mt = missingTypes[mi];
                  step++;
                  statusDiv.text(
                    prefix + "scanning " + mt.label + " " + (ci + 1) + "/" +
                      collected.classes.length + ": " + cls.name,
                  );
                  progressBar.css("width", overall(ui, (step / totalSteps) * 0.3) + "%");
                  try {
                    var found = await scanClassForType(collected.subjectid, cls, mt.id, mt.label);
                    scanned[mt.id] = scanned[mt.id].concat(found);
                  } catch (scanErr) {
                    console.warn("[PESUClaw] warn: " + cls.name + " (" + mt.label + ")", scanErr);
                  }
                  await sleep(300);
                }
              }
              if (_bulkCancel) break;
              missingTypes.forEach(function (rt) {
                cachedUnit[rt.id] = scanned[rt.id];
              });
            }

            var unitSafe = safeFileName(u.label, "Unit" + (ui + 1));
            for (var ti = 0; ti < types.length; ti++) {
              if (_bulkCancel) break;
              var rt = types[ti];
              var chosen = (cachedUnit[rt.id] || []).filter(isItemSelected);
              if (!chosen.length) continue;

              var folder = multiUnit
                ? unitSafe + "/" + rt.label + "/"
                : types.length > 1
                  ? rt.label + "/"
                  : "";
              var res = await processItems(chosen, rt.label, {
                shouldCancel: cancelled,
                onProgress: function (i, n, item) {
                  statusDiv.text(
                    prefix + "fetching " + rt.label + " " + (i + 1) + "/" + n + ": " + item.title,
                  );
                  progressBar.css(
                    "width",
                    overall(ui, 0.3 + 0.7 * ((ti + i / n) / types.length)) + "%",
                  );
                },
              });
              if (res.cancelled) break;
              await packResult(zip, folder, unitSafe, rt.label, res, groups, totals);
            }
          }

          if (_bulkCancel) {
            summaryLines.push("Cancelled \u2014 nothing was downloaded.");
          } else if (totals.pdfs + totals.others === 0) {
            summaryLines.push("No files were found to download.");
          } else {
            statusDiv.text("Creating ZIP...");
            addMergeHelpers(zip, groups);
            var blob = await zip.generateAsync({ type: "blob" });
            var zipName =
              (multiUnit ? "PESU_AllUnits" : safeFileName(units[0].label, "files")) +
              "_" + typesLabel + ".zip";
            triggerDownload(blob, zipName);
            summaryLines.push(
              (multiUnit ? units.length - skippedUnits.length + " units \u00b7 " : "") +
                totals.pdfs + " PDFs merged (" + totals.pages + " pages) \u00b7 " +
                totals.others + " other files" +
                (groups.length ? " \u00b7 merge_office_files.py included" : "") +
                " \u00b7 " + formatSize(blob.size),
            );
          }
          if (skippedUnits.length) {
            summaryLines.push("No content found for: " + skippedUnits.join(", "));
          }
          if (totals.failed) summaryLines.push(totals.failed + " failed");
        } catch (err) {
          console.error("[PESUClaw] Bulk download failed:", err);
          summaryLines.push("Failed: " + (err && err.message ? err.message : err));
        } finally {
          // Put the page back on the unit the user was looking at
          if (
            multiUnit &&
            startUnitId &&
            $startAnchor.length &&
            getActiveUnitId() !== startUnitId
          ) {
            $startAnchor[0].click();
            await waitForUnitReady(startUnitId, function () {
              return false;
            }, 50);
          }
          _bulkRunning = false;
          _bulkCancel = false;
          cancelBtn.hide();
          progressWrap.hide();
          refetchBtn.prop("disabled", false).css("opacity", 1);
          _lastActiveTab = getActiveUnitText();
          renderOrFetch();
          statusDiv.empty();
          summaryLines.forEach(function (line) {
            statusDiv.append($("<div></div>").text(line));
          });
        }
      }

      // ─── Fetch & render ───
      // Scans one class row for downloadable resources of one type.
      // Returns a de-duplicated array of items; throws if the request fails.
      async function scanClassForType(subjectid, cls, typeId, typeLabel) {
        var found = [];
        var response = await $.get("/Academy/s/studentProfilePESUAdmin", {
          url: "studentProfilePESUAdmin",
          controllerMode: "6403",
          actionType: "60",
          selectedData: subjectid,
          id: typeId,
          unitid: cls.id,
        });
        if (typeof response === "string") {
          var $html = $("<div>").html(response);
          var itemsBefore = found.length;
          // Pattern 1: onclick with downloadcoursedoc('id')
          $html
            .find('[onclick*="downloadcoursedoc"]')
            .each(function () {
              var onclick = $(this).attr("onclick") || "";
              var m = onclick.match(/downloadcoursedoc\('([^']+)'\)/);
              if (m) {
                found.push({
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
                found.push({
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
              found.push({
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
                found.push({
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
              found.push({
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
              found.push({
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
                found.push({
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
              found.push({
                title: cls.name,
                id: src,
                className: cls.name,
                isSlideUrl: true,
                typeId: typeId,
              });
            }
          });
          var itemsFound = found.length - itemsBefore;
          if (itemsFound > 0) {
            console.log(
              "[PESUClaw] Found " +
                itemsFound +
                " items for " +
                typeLabel +
                " class=" +
                cls.name +
                " (classId=" +
                cls.id +
                "). IDs: " +
                found
                  .slice(itemsBefore)
                  .map(function (it) {
                    return it.id;
                  })
                  .join(", "),
            );
          } else if (response.length > 100) {
            console.log(
              "[PESUClaw] DEBUG: No items for " +
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
        var seenKeys = new Set();
        return found.filter(function (it) {
          var key = (it.isSlideUrl ? "u:" : "d:") + it.id;
          if (seenKeys.has(key)) return false;
          seenKeys.add(key);
          return true;
        });
      }

      async function fetchAndRender(force) {
        // Cancel previous fetch by bumping version
        _fetchVersion++;
        var myVersion = _fetchVersion;
        _fetching = false; // allow re-entry
        if (_bulkRunning) return;

        var unitKey = getActiveUnitText();
        if (!cache[unitKey]) cache[unitKey] = {};
        var cachedUnit = cache[unitKey];

        // Only scan the selected types that aren't cached yet
        var typesToFetch = force
          ? selectedTypes.slice()
          : selectedTypes.filter(function (tid) {
              return !cachedUnit.hasOwnProperty(tid);
            });
        if (!typesToFetch.length) {
          console.log("[PESUClaw] Cache hit: " + unitKey);
          renderItems(unitKey, cachedUnit, true);
          return;
        }

        _fetching = true;
        refetchBtn.prop("disabled", true).css("opacity", 0.5);
        titleDiv.text("Loading " + unitKey + "...");
        statusDiv.text("Detecting course content...");
        contentArea.empty();
        progressWrap.show();
        progressBar.css("width", "20%");

        // Helper to check if this fetch is still current
        function isCancelled() {
          return _fetchVersion !== myVersion;
        }

        try {
          // PESU exposes course-content IDs directly in the page.
          // (The old /getCourse endpoint returns 403, so it isn't used.)
          var $activeUnit = getActiveUnitAnchor();
          if (!$activeUnit.length) {
            throw new Error("Could not determine active PESU unit");
          }
          var activeUnitId = parseUnitId($activeUnit);
          if (!activeUnitId) {
            throw new Error("Could not determine active unit ID");
          }
          var activeUnitText = getUnitLabel($activeUnit) || unitKey;
          unitLabels[unitKey] = activeUnitText;
          console.log("[PESUClaw] Active unit:", activeUnitText, "| ID:", activeUnitId);

          var readiness = await waitForUnitReady(activeUnitId, isCancelled, 50);
          if (readiness === "cancelled" || isCancelled()) {
            _fetching = false;
            return;
          }
          if (readiness !== "ready") {
            throw new Error(
              "PESU course content did not update for unit " + activeUnitId,
            );
          }

          // Now that the DOM definitely contains the active unit,
          // collect ONLY its course-content rows.
          var collected = collectClasses(activeUnitId);
          var subjectid = collected.subjectid;
          var classes = collected.classes;
          if (!subjectid) {
            throw new Error(
              "Could not determine subject ID from active unit content",
            );
          }
          console.log(
            "[PESUClaw] Unit:", activeUnitText, "| ID:", activeUnitId,
            "| Subject:", subjectid, "| Content found:", classes.length,
          );
          console.log(
            "[PESUClaw] Content IDs:",
            classes.map(function (c) {
              return c.id + " \u2192 " + c.name;
            }),
          );

          if (!classes.length) {
            statusDiv.text("No course content found");
            titleDiv.text("No content");
            _fetching = false;
            refetchBtn.prop("disabled", false).css("opacity", 1);
            progressWrap.hide();
            return;
          }

          // Scan download links for each selected resource type
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
              progressBar.css("width", 25 + Math.round((step / totalSteps) * 70) + "%");
              statusDiv.text(
                "Scanning " + typeLabel + " " + (i + 1) + "/" + classes.length + ": " + cls.name,
              );
              if (isCancelled()) {
                _fetching = false;
                return;
              }

              try {
                var found = await scanClassForType(subjectid, cls, typeId, typeLabel);
                newItems[typeId] = newItems[typeId].concat(found);
              } catch (err) {
                console.warn(
                  "[PESUClaw] warn: " + cls.name + " (" + typeLabel + ")",
                  err.statusText || err,
                );
              }
              if (step < totalSteps) await sleep(300);
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
          console.log("[PESUClaw] Cached: " + unitKey + " (" + totalCached + " total items)");
          renderItems(unitKey, cachedUnit, false);
        } catch (err) {
          console.error("[PESUClaw] Fetch error:", err);
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
            console.log("[PESUClaw] Tab: " + _lastActiveTab + " -> " + newTab);
            _lastActiveTab = newTab;
            if (_bulkRunning) return; // tabs are being switched by PESUClaw itself
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

      console.log("[PESUClaw] Ready");

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