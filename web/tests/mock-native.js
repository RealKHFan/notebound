// Loaded only by the test server, before app.js. Stands in for the
// @JavascriptInterface object that MainActivity injects on Android.
(function () {
  window.NoteboundNative = {
    call: function (id, method, json) {
      fetch('/__mock/call', { method: 'POST', body: JSON.stringify({ method: method, args: JSON.parse(json || '{}') }) })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          setTimeout(function () {
            if (r.ok) window.__nbNative.resolve(id, JSON.stringify(r.result));
            else window.__nbNative.reject(id, r.error);
          }, 0);
        })
        .catch(function (e) { window.__nbNative.reject(id, String(e)); });
    },
  };
  // Tests push host events (back button, keyboard, resume...) through this.
  window.__mockEmit = function (name, data) {
    window.__nbNative.emit(name, data == null ? null : JSON.stringify(data));
  };
})();
