(function () {
  'use strict';

  var api = globalThis.browser || globalThis.chrome;
  var manifest = api.runtime.getManifest();
  var currentVersion = normalizeVersion(manifest.version || '0.0.0');
  var actionApi = api.action || api.browserAction || null;
  var statusEl = document.getElementById('update-status');
  var footerEl = document.getElementById('version-footer');
  var latestReleaseUrl = 'https://api.github.com/repos/AAK1767/PESUClaw/releases/latest';
  var releasePageUrl = 'https://github.com/AAK1767/PESUClaw/releases/latest';

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
    statusEl.appendChild(document.createTextNode(message.text || ''));

    if (message.linkText && message.linkUrl) {
      statusEl.appendChild(document.createTextNode(' '));
      var link = document.createElement('a');
      link.href = message.linkUrl;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = message.linkText;
      statusEl.appendChild(link);
    }
  }

  async function checkForUpdate() {
    try {
      setStatus({ text: 'Checking GitHub for updates...' }, 'checking');

      var response = await fetch(latestReleaseUrl, {
        headers: {
          Accept: 'application/vnd.github+json'
        }
      });

      if (!response.ok) {
        throw new Error('GitHub responded with ' + response.status);
      }

      var release = await response.json();
      var latestVersion = normalizeVersion(release.tag_name || release.name || '');

      if (!latestVersion) {
        throw new Error('Could not determine the latest release version');
      }

      if (compareVersions(latestVersion, currentVersion) > 0) {
        setStatus(
          {
            text: 'Update available: v' + latestVersion + '.',
            linkText: 'Open release',
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

      setStatus({ text: 'You are on the latest release.' }, 'ready');

      if (actionApi && actionApi.setBadgeText) {
        actionApi.setBadgeText({ text: '' });
        if (actionApi.setTitle) {
          actionApi.setTitle({ title: 'PESUClaw v' + currentVersion });
        }
      }
    } catch (error) {
      setStatus(
        {
          text: 'Could not check GitHub releases. '
        },
        'error'
      );
      statusEl.appendChild(document.createTextNode(error && error.message ? error.message : ''));
    }
  }

  checkForUpdate();
})();
