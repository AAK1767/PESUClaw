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

      // ─── Icons (inline SVG, inherit currentColor) ───
      function svg(inner) {
        return (
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          inner +
          "</svg>"
        );
      }
      var ICONS = {
        logo: svg('<path d="M12 3v11"/><path d="m7.5 10 4.5 4.5 4.5-4.5"/><path d="M4 17v1.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V17"/>'),
        download: svg('<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/>'),
        refresh: svg('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),
        close: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
        chevron: svg('<path d="m6 9 6 6 6-6"/>'),
        layers: svg('<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>'),
        folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
        alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5v.01"/>'),
      };

      // ─── Build DOM ───
      $("#pesu-dl-helper").remove();
      $("#pesu-dl-tab-btn").remove();

      // Tab button (inherits PESU's own tab styling; see panel.css)
      const navBtn = $(
        '<li id="pesu-dl-tab-btn"><a href="javascript:void(0)">PESUClaw</a></li>',
      );
      $("#courselistunit").append(navBtn);

      // Panel
      const container = $(
        '<div id="pesu-dl-helper" role="dialog" aria-label="PESUClaw"></div>',
      );
      const updateNotice = $('<div class="pesu-dl-update"></div>').hide();
      const titleDiv = $('<div id="pesu-dl-title"></div>');
      const statusDiv = $(
        '<div id="pesu-dl-status" role="status" aria-live="polite"></div>',
      );

      const progressWrap = $('<div class="pesu-dl-progress-wrap"></div>');
      const progressBar = $('<div class="pesu-dl-progress-bar"></div>');
      progressWrap.append(progressBar);
      const cancelBtn = $('<button type="button" class="pesu-dl-btn-cancel"></button>')
        .text("Cancel")
        .on("click", function () {
          _bulkCancel = true;
          statusDiv.attr("data-kind", "loading").text("Cancelling...");
        });
      const statusWrap = $('<div class="pesu-statusbar"></div>')
        .append(statusDiv)
        .append(progressWrap)
        .append(cancelBtn);

      const contentArea = $('<div id="pesu-dl-content"></div>');
      const actionsArea = $('<div class="pesu-dl-actions"></div>').hide();

      // Footer: version, links, update state
      const footerStatus = $('<span id="pesu-foot-status"></span>');
      const footer = $('<div class="pesu-dl-footer"></div>')
        .append($("<span></span>").text("PESUClaw v" + PESUCLAW_VERSION))
        .append(
          $('<span class="pesu-foot-links"></span>')
            .append(footerStatus)
            .append($('<span class="pesu-foot-sep">\u00b7</span>'))
            .append(
              $("<a>")
                .attr({ href: releasePageUrl, target: "_blank", rel: "noreferrer" })
                .text("Latest releases"),
            )
            .append($('<span class="pesu-foot-sep">\u00b7</span>'))
            .append(
              $("<a>")
                .attr({ href: repoUrl, target: "_blank", rel: "noreferrer" })
                .text("GitHub"),
            ),
        );

      // Header
      const topBar = $('<div class="pesu-dl-topbar"></div>');
      const refetchBtn = $(
        '<button type="button" class="pesu-dl-btn-refresh" title="Rescan this unit" aria-label="Rescan this unit"></button>',
      ).html(ICONS.refresh);
      const closeBtn = $(
        '<button type="button" class="pesu-dl-btn-close" title="Close" aria-label="Close"></button>',
      ).html(ICONS.close);
      topBar.append(refetchBtn).append(closeBtn);
      const header = $('<div class="pesu-hdr"></div>')
        .append(
          $('<div class="pesu-brand"></div>')
            .append($('<span class="pesu-logo"></span>').html(ICONS.logo))
            .append(
              $('<div class="pesu-brand-text"></div>')
                .append($('<div class="pesu-brand-name">PESUClaw</div>'))
                .append(titleDiv),
            ),
        )
        .append(topBar);

      // ─── Type toggle bar (multi-select) ───
      var typeBar = $('<div class="pesu-dl-type-bar"></div>');
      RESOURCE_TYPES.forEach(function (rt) {
        var tbtn = $('<button type="button" class="pesu-dl-type-btn"></button>')
          .append($('<span class="pesu-dl-type-label"></span>').text(rt.label))
          .append($('<span class="pesu-dl-count"></span>'))
          .attr("data-type-id", rt.id)
          .attr("aria-pressed", selectedTypes.indexOf(rt.id) >= 0 ? "true" : "false")
          .attr("title", "Click to add or remove. Select several to download them together.");
        if (selectedTypes.indexOf(rt.id) >= 0) tbtn.addClass("selected");
        tbtn.on("click", function () {
          if (_bulkRunning) return;
          var tid = $(this).attr("data-type-id");
          var pos = selectedTypes.indexOf(tid);
          if (pos >= 0) {
            if (selectedTypes.length === 1) return; // keep at least one
            selectedTypes.splice(pos, 1);
            $(this).removeClass("selected").attr("aria-pressed", "false");
          } else {
            selectedTypes.push(tid);
            $(this).addClass("selected").attr("aria-pressed", "true");
          }
          // Cancel any in-progress fetch
          if (_fetching) {
            _fetchVersion++;
            _fetching = false;
            refetchBtn.prop("disabled", false);
          }
          if (container.is(":visible")) {
            renderOrFetch();
          }
        });
        typeBar.append(tbtn);
      });
      const typeWrap = $('<div class="pesu-types"></div>')
        .append(
          $('<div class="pesu-caption"></div>')
            .text("Resources ")
            .append($("<span></span>").text("\u00b7 pick one or more")),
        )
        .append(typeBar);

      container
        .append(header)
        .append(updateNotice)
        .append(typeWrap)
        .append(statusWrap)
        .append(contentArea)
        .append(actionsArea)
        .append(footer);
      $("body").append(container);

      function openPanel() {
        container.addClass("pesu-open");
        navBtn.addClass("active");
      }
      function closePanel() {
        container.removeClass("pesu-open");
        navBtn.removeClass("active");
      }
      closeBtn.on("click", closePanel);
      // Esc closes the panel (namespaced so re-injection doesn't stack handlers)
      $(document)
        .off("keydown.pesuclaw")
        .on("keydown.pesuclaw", function (e) {
          if (e.key === "Escape" && container.is(":visible") && !_bulkRunning) {
            closePanel();
          }
        });

      // ─── View helpers ───
      function makeBtn(cls, iconName, label) {
        return $('<button type="button" class="pesu-btn ' + cls + '"></button>')
          .append($('<span class="pesu-btn-ico"></span>').html(ICONS[iconName] || ""))
          .append($('<span class="pesu-btn-label"></span>').text(label));
      }
      function setBtnLabel($btn, text) {
        $btn.find(".pesu-btn-label").text(text);
      }
      function setBusy(on) {
        container.toggleClass("pesu-busy", !!on);
      }
      function setStatus(text, kind) {
        statusDiv
          .attr("data-kind", kind || "info")
          .empty()
          .append($('<div class="pesu-status-text"></div>').text(text));
      }
      // Multi-line result summary (each line stacked under the status dot)
      function setStatusLines(lines, kind) {
        var $text = $('<div class="pesu-status-text"></div>');
        lines.forEach(function (line) {
          $text.append($("<div></div>").text(line));
        });
        statusDiv.attr("data-kind", kind || "info").empty().append($text);
      }
      function clearView() {
        contentArea.empty();
        actionsArea.empty().hide();
      }
      function showSkeleton() {
        var html = "";
        for (var k = 0; k < 4; k++) html += '<div class="pesu-skel"></div>';
        contentArea.html(html);
      }
      function showEmpty(title, hint, opts) {
        opts = opts || {};
        var box = $('<div class="pesu-empty"></div>').toggleClass("is-error", !!opts.error);
        box.append($('<div class="pesu-empty-ico"></div>').html(opts.error ? ICONS.alert : ICONS.folder));
        box.append($('<div class="pesu-empty-title"></div>').text(title));
        if (hint) box.append($('<div class="pesu-empty-hint"></div>').text(hint));
        if (opts.retry) {
          var retryBtn = makeBtn("pesu-btn-ghost", "refresh", "Try again");
          retryBtn.on("click", function () {
            fetchAndRender(true);
          });
          box.append(retryBtn);
        }
        contentArea.empty().append(box);
      }
      var _refreshSummary = function () {};

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
          .text("Update check unavailable")
          .attr({ title: message || "", "data-kind": "warn" });
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
          footerStatus.text("Up to date").attr({ title: "", "data-kind": "ok" });
          return;
        }
          footerStatus
            .text("Update available")
            .attr({ title: "", "data-kind": "warn" });
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
          closePanel();
        } else {
          openPanel();
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

      // Updates the status chip on a file row (row element id = item._uid)
      function setItemState(item, state, text) {
        if (!item || !item._uid) return;
        $("#" + item._uid)
          .attr("data-state", state)
          .find(".pesu-row-state")
          .text(text)
          .attr("title", text);
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
        clearView();
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

        titleDiv.text(unitLabel);

        // Show how many files each (already scanned) type has on its chip
        typeBar.find(".pesu-dl-type-btn").each(function () {
          var tid = $(this).attr("data-type-id");
          $(this)
            .find(".pesu-dl-count")
            .text(cachedUnit.hasOwnProperty(tid) ? cachedUnit[tid].length : "");
        });

        console.log(
          "[PESUClaw] " + typeNames + " " + unitLabel + " \u2014 " + totalCount +
            " files" + (fromCache ? " (cached)" : ""),
        );

        var rows = []; // { item, $row, $cb, haystack, visible }
        var sectionRefs = [];
        var primaryBtn = null;

        function selectedCount() {
          return rows.filter(function (r) {
            return isItemSelected(r.item);
          }).length;
        }

        function refreshSummary() {
          if (container.hasClass("pesu-busy")) return;
          var n = selectedCount();
          sectionRefs.forEach(function (sec) {
            sec.$count.text(sec.items.filter(isItemSelected).length + "/" + sec.items.length);
          });
          if (totalCount > 0) {
            setStatus(
              n + " of " + totalCount + " file" + (totalCount === 1 ? "" : "s") +
                " selected" + (fromCache ? " \u00b7 cached" : ""),
              "info",
            );
          }
          if (primaryBtn) {
            primaryBtn.removeAttr("data-state").prop("disabled", n === 0);
            setBtnLabel(
              primaryBtn,
              types.length === 1
                ? "Download " + types[0].label + " \u00b7 " + n + (n === 1 ? " file" : " files")
                : "Download " + n + (n === 1 ? " file" : " files") + " \u00b7 ZIP",
            );
          }
        }
        _refreshSummary = refreshSummary;

        // Action bar (primary = this unit, ghost = every unit)
        var allBtn = makeBtn("pesu-btn-ghost pesu-act-all", "layers", "All units").attr(
          "title",
          "Visit every unit and bundle the selected types into one ZIP",
        );
        allBtn.on("click", function () {
          runBulk("all", types, allBtn);
        });

        if (!totalCount) {
          setStatus("Nothing found for " + typeNames, "info");
          showEmpty(
            "No " + typeNames + " in this unit",
            "Try another unit or resource type, or rescan if you just opened the course.",
          );
          actionsArea.append($('<div class="pesu-btn-row"></div>').append(allBtn)).show();
          return;
        }

        primaryBtn = makeBtn("pesu-btn-primary pesu-act-primary", "download", "Download");
        primaryBtn.on("click", function () {
          if (types.length === 1) {
            var chosen = (cachedUnit[types[0].id] || []).filter(isItemSelected);
            mergeAndDownload(unitLabel, chosen, types[0].label, primaryBtn);
          } else {
            runBulk("current", types, primaryBtn);
          }
        });
        actionsArea
          .append($('<div class="pesu-btn-row"></div>').append(primaryBtn).append(allBtn))
          .append(
            $('<div class="pesu-hint"></div>').text(
              types.length > 1
                ? "One ZIP \u00b7 a folder per resource type, PDFs merged inside"
                : "PDFs merge into one file \u00b7 everything else goes in a ZIP",
            ),
          )
          .show();

        // Quick filter for long lists
        var filterInput = null;
        function applyFilter() {
          var q = filterInput ? filterInput.val().trim().toLowerCase() : "";
          rows.forEach(function (r) {
            r.visible = !q || r.haystack.indexOf(q) >= 0;
            r.$row.toggleClass("pesu-hidden", !r.visible);
          });
          sectionRefs.forEach(function (sec) {
            var any = sec.rows.some(function (r) {
              return r.visible !== false;
            });
            sec.$noMatch.css("display", any ? "none" : "block");
          });
        }
        if (totalCount > 6) {
          filterInput = $('<input type="search" class="pesu-filter" placeholder="Filter files\u2026" aria-label="Filter files">');
          filterInput.on("input", applyFilter);
          contentArea.append(filterInput);
        }

        // One card per selected type
        types.forEach(function (rt) {
          var items = cachedUnit[rt.id] || [];
          var secRows = [];
          var $sec = $('<section class="pesu-sec"></section>');
          var $count = $('<span class="pesu-sec-count"></span>');
          var $toggle = $('<button type="button" class="pesu-sec-toggle" aria-expanded="true"></button>')
            .append($('<span class="pesu-sec-chev"></span>').html(ICONS.chevron))
            .append($("<span></span>").text(rt.label))
            .append($count);
          $toggle.on("click", function () {
            var collapsed = !$sec.hasClass("is-collapsed");
            $sec.toggleClass("is-collapsed", collapsed);
            $toggle.attr("aria-expanded", collapsed ? "false" : "true");
          });

          function setAll(value) {
            secRows.forEach(function (r) {
              if (r.visible === false) return;
              r.item.selected = value;
              r.$cb.prop("checked", value);
              r.$row.toggleClass("is-off", !value);
            });
            refreshSummary();
          }

          var $tools = $('<div class="pesu-sec-tools"></div>')
            .append(
              $('<button type="button" class="pesu-link">All</button>').on("click", function () {
                setAll(true);
              }),
            )
            .append($('<span class="pesu-foot-sep">\u00b7</span>'))
            .append(
              $('<button type="button" class="pesu-link">None</button>').on("click", function () {
                setAll(false);
              }),
            );

          $sec.append($('<div class="pesu-sec-head"></div>').append($toggle).append($tools));

          var $noMatch = $('<div class="pesu-nomatch"></div>').text("No files match your filter");
          var $list = $('<ul class="pesu-list"></ul>');

          if (!items.length) {
            $list.append(
              $('<li class="pesu-row"></li>').append(
                $('<span class="pesu-row-main"></span>').append(
                  $('<span class="pesu-row-sub"></span>').text("No files found for " + rt.label),
                ),
              ),
            );
          }

          items.forEach(function (t, idx) {
            t._uid = "pesu-dl-item-" + rt.id + "-" + idx;
            var sub = t.className && t.className !== t.title ? t.className : "";

            var $cb = $('<input type="checkbox" class="pesu-chk">')
              .prop("checked", isItemSelected(t))
              .attr("aria-label", "Include " + t.title);
            var $text = $('<span class="pesu-row-text"></span>').append(
              $('<span class="pesu-row-title"></span>').text(t.title).attr("title", t.title),
            );
            if (sub) $text.append($('<span class="pesu-row-sub"></span>').text(sub).attr("title", sub));

            var $dl = $('<button type="button" class="pesu-row-dl"></button>')
              .html(ICONS.download)
              .attr({ title: "Download only this file", "aria-label": "Download " + t.title });

            var $row = $('<li class="pesu-row" id="' + t._uid + '"></li>')
              .toggleClass("is-off", !isItemSelected(t))
              .append(
                $('<label class="pesu-row-main"></label>').append($cb).append($text),
              )
              .append($('<span class="pesu-row-state"></span>'))
              .append($dl);

            $cb.on("change", function () {
              t.selected = this.checked;
              $row.toggleClass("is-off", !this.checked);
              refreshSummary();
            });

            $dl.on("click", function () {
              $dl.prop("disabled", true);
              setItemState(t, "busy", "fetching\u2026");
              downloadIndividualItem(t, idx)
                .then(function () {
                  setItemState(t, "done", "downloaded");
                })
                .catch(function (error) {
                  console.error("[PESUClaw] Individual download failed:", error);
                  setItemState(t, "failed", "failed");
                })
                .then(function () {
                  $dl.prop("disabled", false);
                });
            });

            var rowRef = {
              item: t,
              $row: $row,
              $cb: $cb,
              haystack: (t.title + " " + (t.className || "")).toLowerCase(),
              visible: true,
            };
            rows.push(rowRef);
            secRows.push(rowRef);
            $list.append($row);
          });

          $sec.append($list).append($noMatch);
          contentArea.append($sec);
          sectionRefs.push({ items: items, rows: secRows, $count: $count, $noMatch: $noMatch });
        });

        refreshSummary();
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
                setItemState(item, "merged", srcPdf.getPageCount() + " pg merged");
              } catch (e) {
                res.failed++;
                setItemState(item, "failed", "error");
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
              setItemState(item, "zipped", "zipped ." + finalName.split(".").pop());
            }
          } catch (err) {
            res.failed++;
            setItemState(item, "failed", "failed");
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
          setStatus("Nothing selected to download", "info");
          return;
        }
        setBtnLabel(btn, "Working\u2026");
        btn.removeAttr("data-state").prop("disabled", true);
        setBusy(true);
        setStatus("Starting\u2026", "loading");
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
              res.pdfCount + (res.pdfCount === 1 ? " PDF" : " PDFs") + " merged \u00b7 " +
                res.mergedPdf.getPageCount() + " pages \u00b7 " + formatSize(pdfBlob.size),
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
              res.otherFiles.length + (res.otherFiles.length === 1 ? " file" : " files") +
                " zipped" +
                (res.officeFiles.length ? " \u00b7 merge script included" : "") +
                " \u00b7 " + formatSize(zipBlob.size),
            );
          }

          if (res.pdfCount === 0 && res.otherFiles.length === 0) {
            btn.attr("data-state", "error");
            setBtnLabel(btn, "Nothing downloaded");
            setStatus(
              "Could not process any files." + (res.failed ? " " + res.failed + " failed." : ""),
              "error",
            );
          } else {
            btn.attr("data-state", "done");
            setBtnLabel(btn, "Downloaded");
            if (res.failed) statusParts.push(res.failed + " failed \u2014 see the red chips");
            setStatusLines(statusParts, res.failed ? "info" : "ok");
          }
        } catch (err) {
          console.error("[PESUClaw] Merge failed:", err);
          btn.attr("data-state", "error");
          setBtnLabel(btn, "Failed \u2014 try again");
          setStatus("Failed: " + (err && err.message ? err.message : err), "error");
        }
        btn.prop("disabled", false);
        setBusy(false);
        progressWrap.hide();
        // Put the button label back after a moment
        setTimeout(function () {
          btn.removeAttr("data-state");
          _refreshSummary();
        }, 4500);
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
          setStatus("Could not find any units", "error");
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
        var bulkKind = "info";

        setBusy(true);
        refetchBtn.prop("disabled", true);
        setBtnLabel(btn, "Working\u2026");
        setStatus("Starting\u2026", "loading");
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
            bulkKind = "info";
          } else if (totals.pdfs + totals.others === 0) {
            summaryLines.push("No files were found to download.");
            bulkKind = "info";
          } else {
            statusDiv.text("Creating ZIP...");
            addMergeHelpers(zip, groups);
            var blob = await zip.generateAsync({ type: "blob" });
            var zipName =
              (multiUnit ? "PESU_AllUnits" : safeFileName(units[0].label, "files")) +
              "_" + typesLabel + ".zip";
            triggerDownload(blob, zipName);
            bulkKind = "ok";
            summaryLines.push(
              (multiUnit ? units.length - skippedUnits.length + " units \u00b7 " : "") +
                totals.pdfs + " PDFs merged (" + totals.pages + " pages) \u00b7 " +
                totals.others + " other files" +
                (groups.length ? " \u00b7 merge script included" : "") +
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
          bulkKind = "error";
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
          refetchBtn.prop("disabled", false);
          setBusy(false);
          _lastActiveTab = getActiveUnitText();
          renderOrFetch();
          setStatusLines(summaryLines, bulkKind);
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
        refetchBtn.prop("disabled", true);
        titleDiv.text(unitLabels[unitKey] || unitKey);
        setStatus("Detecting course content...", "loading");
        clearView();
        showSkeleton();
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
            setStatus("No course content found", "info");
            showEmpty(
              "No course content in this unit",
              "PESU didn\u2019t list any classes here. Try another unit.",
            );
            _fetching = false;
            refetchBtn.prop("disabled", false);
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
          var rawMsg = String(err.message || err);
          setStatus("Couldn\u2019t load this unit", "error");
          showEmpty(
            "Something went wrong",
            /did not update/i.test(rawMsg)
              ? "PESU hasn\u2019t finished loading this unit. Give it a moment, then try again."
              : rawMsg,
            { error: true, retry: true },
          );
          progressWrap.hide();
        }

        _fetching = false;
        refetchBtn.prop("disabled", false);
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