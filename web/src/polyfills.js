// Small polyfills so older Android WebViews (Chrome 80+) can run the app.
/* eslint-disable no-extend-native */
if (!Array.prototype.at) {
  const at = function at(n) {
    const len = this.length;
    let i = Math.trunc(n) || 0;
    if (i < 0) i += len;
    return i < 0 || i >= len ? undefined : this[i];
  };
  Object.defineProperty(Array.prototype, 'at', { value: at, writable: true, configurable: true });
  Object.defineProperty(String.prototype, 'at', { value: at, writable: true, configurable: true });
}
if (!Object.hasOwn) {
  Object.defineProperty(Object, 'hasOwn', { value: (o, k) => Object.prototype.hasOwnProperty.call(o, k), writable: true, configurable: true });
}
if (!Array.prototype.findLast) {
  Object.defineProperty(Array.prototype, 'findLast', {
    value(fn, thisArg) { for (let i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return this[i]; return undefined; },
    writable: true, configurable: true,
  });
  Object.defineProperty(Array.prototype, 'findLastIndex', {
    value(fn, thisArg) { for (let i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return i; return -1; },
    writable: true, configurable: true,
  });
}
if (!String.prototype.replaceAll) {
  Object.defineProperty(String.prototype, 'replaceAll', {
    value(search, replacement) {
      if (search instanceof RegExp) return this.replace(search, replacement);
      return this.split(search).join(typeof replacement === 'function' ? replacement(search) : replacement);
    },
    writable: true, configurable: true,
  });
}
