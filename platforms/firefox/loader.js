// PESUClaw — Firefox Loader
// Injects libraries and content script into the page's MAIN world
// (Firefox content scripts run in an isolated sandbox by default)

(function () {
  'use strict';

  var scripts = [
    browser.runtime.getURL('lib/pdf-lib.min.js'),
    browser.runtime.getURL('lib/jszip.min.js'),
    browser.runtime.getURL('content.js')
  ];

  function injectNext(index) {
    if (index >= scripts.length) return;
    var s = document.createElement('script');
    s.src = scripts[index];
    s.onload = function () {
      s.remove();
      injectNext(index + 1);
    };
    (document.head || document.documentElement).appendChild(s);
  }

  injectNext(0);
})();
