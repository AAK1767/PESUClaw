(function () {
  'use strict';

  var api = globalThis.browser || globalThis.chrome;
  var manifest = api.runtime.getManifest();
  var currentVersion = normalizeVersion(manifest.version || '0.0.0');
  var actionApi = api.action || api.browserAction || null;
  var statusEl = document.getElementById('update-status');
  var footerEl = document.getElementById('version-footer');
  var repoUrl = 'https://github.com/AAK1767/PESUClaw';
  var latestReleaseUrl = 'https://api.github.com/repos/AAK1767/PESUClaw/releases/latest';
  var releasePageUrl = repoUrl + '/releases/latest';
  // Fallback that avoids GitHub's API rate limit (tag list only, CORS-enabled)
  var jsdelivrTagsUrls = [
    'https://data.jsdelivr.com/v1/packages/gh/AAK1767/PESUClaw',
    'https://data.jsdelivr.com/v1/package/gh/AAK1767/PESUClaw'
  ];
  var updateCacheKey = 'pesuclaw.latestRelease';
  var updateCacheTtl = 6 * 60 * 60 * 1000;
  var updateFailureTtl = 30 * 60 * 1000;

  if (footerEl) {
    footerEl.textContent = 'Installed v' + currentVersion;
  }

  function normalizeVersion(version) {
    return String(version).trim().replace(/^v/i, '');
  }

  function parseVersion(version) {
    return normalizeVersion(version)
      .split('.')
      .map(function (part) {
        var parsed = parseInt(part, 10);
        return isFinite(parsed) ? parsed : 0;
      });
  }

  function compareVersions(left, right) {
    var leftParts = parseVersion(left);
    var rightParts = parseVersion(right);
    var maxLength = Math.max(leftParts.length, rightParts.length);

    for (var index = 0; index < maxLength; index++) {
      var leftPart = leftParts[index] || 0;
      var rightPart = rightParts[index] || 0;
      if (leftPart > rightPart) return 1;
      if (leftPart < rightPart) return -1;
    }

    return 0;
  }

  function setStatus(message, kind) {
    if (!statusEl) return;
    statusEl.className = 'update' + (kind ? ' ' + kind : '');
    statusEl.textContent = '';

    var text = document.createElement('div');
    text.appendChild(document.createTextNode(message.text || ''));
    if (message.linkText && message.linkUrl) {
      text.appendChild(document.createTextNode(' '));
      var link = document.createElement('a');
      link.href = message.linkUrl;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = message.linkText;
      text.appendChild(link);
    }
    statusEl.appendChild(text);
    if (message.title) statusEl.title = message.title;
  }

  function fetchJson(url, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, timeoutMs || 8000);
    // No custom headers: keeps this a simple CORS request (no preflight).
    return fetch(url, { signal: controller.signal, cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) {
          throw new Error(url + ' responded with ' + response.status);
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
      errors.push('GitHub API returned no release');
    } catch (error) {
      errors.push(String(error && error.message ? error.message : error));
    }

    // 2) jsDelivr tag list
    for (var i = 0; i < jsdelivrTagsUrls.length; i++) {
      try {
        var data = await fetchJson(jsdelivrTagsUrls[i]);
        var versions = (data && data.versions ? data.versions : [])
          .map(function (entry) {
            return String(entry && entry.version ? entry.version : entry);
          })
          .filter(function (version) {
            return /^v?\d+(\.\d+)*$/.test(version);
          });
        if (versions.length) {
          versions.sort(compareVersions);
          var newest = versions[versions.length - 1];
          return { tag_name: newest, html_url: repoUrl + '/releases/tag/' + newest };
        }
        errors.push('jsDelivr returned no tags');
      } catch (error2) {
        errors.push(String(error2 && error2.message ? error2.message : error2));
      }
    }

    throw new Error(errors.join(' | '));
  }

  async function checkForUpdate() {
    try {
      setStatus({ text: 'Checking for updates\u2026' }, 'checking');

      var cached = null;
      try {
        cached = JSON.parse(localStorage.getItem(updateCacheKey) || 'null');
      } catch (error) {
        console.warn('[PESUClaw] Could not read update cache:', error);
      }
      if (cached && cached.checkedAt) {
        var age = Date.now() - cached.checkedAt;
        if (cached.release && age < updateCacheTtl) {
          showReleaseStatus(cached.release);
          return;
        }
        if (cached.failed && age < updateFailureTtl) {
          showCheckFailed(cached.message);
          return;
        }
      }

      var release = await fetchLatestRelease();
      try {
        localStorage.setItem(
          updateCacheKey,
          JSON.stringify({ checkedAt: Date.now(), release: release })
        );
      } catch (error) {
        console.warn('[PESUClaw] Could not save update cache:', error);
      }
      showReleaseStatus(release);
    } catch (error) {
      var message = String(error && error.message ? error.message : error);
      showCheckFailed(message);
      try {
        localStorage.setItem(
          updateCacheKey,
          JSON.stringify({ checkedAt: Date.now(), failed: true, message: message })
        );
      } catch (storageError) {
        /* ignore */
      }
    }
  }

  function showCheckFailed(message) {
    setStatus(
      {
        text: 'Couldn\u2019t check for updates right now.',
        linkText: 'See releases',
        linkUrl: releasePageUrl,
        title: message || ''
      },
      'error'
    );
  }

  function showReleaseStatus(release) {
    var latestVersion = normalizeVersion(release.tag_name || release.name || '');
    if (!latestVersion) {
      showCheckFailed('Could not determine the latest release version');
      return;
    }

    if (compareVersions(latestVersion, currentVersion) > 0) {
      setStatus(
        {
          text: 'Version v' + latestVersion + ' is available.',
          linkText: 'Download update',
          linkUrl: release.html_url || releasePageUrl
        },
        'available'
      );

      if (actionApi && actionApi.setBadgeText) {
        actionApi.setBadgeText({ text: 'UPD' });
        if (actionApi.setBadgeBackgroundColor) {
          actionApi.setBadgeBackgroundColor({ color: '#c62828' });
        }
        if (actionApi.setTitle) {
          actionApi.setTitle({ title: 'PESUClaw update available: v' + latestVersion });
        }
      }
      return;
    }

    setStatus({ text: 'You\u2019re on the latest version (v' + currentVersion + ').' }, 'ready');

    if (actionApi && actionApi.setBadgeText) {
      actionApi.setBadgeText({ text: '' });
      if (actionApi.setTitle) {
        actionApi.setTitle({ title: 'PESUClaw v' + currentVersion });
      }
    }
  }

  checkForUpdate();
})();