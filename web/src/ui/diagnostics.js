// A small in-memory log of errors, so a problem on the phone can be reported
// (Settings > About > Share diagnostic info). Nothing is sent anywhere by itself.
const entries = [];
let device = '';

export function record(kind, message) {
  entries.push(`${new Date().toISOString()} ${kind}: ${String(message).slice(0, 2000)}`);
  if (entries.length > 120) entries.shift();
}

export function setDevice(text) {
  device = text || '';
}

export function installErrorLog() {
  window.addEventListener('error', (e) => record('error', `${e.message} @${e.filename || ''}:${e.lineno || ''}`));
  window.addEventListener('unhandledrejection', (e) => record('promise', e.reason?.stack || e.reason));
  const orig = console.error.bind(console);
  console.error = (...args) => {
    record('console', args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    orig(...args);
  };
}

export function diagnosticsText(version) {
  return [
    `Notebound ${version || ''}`,
    `Device: ${device}`,
    `WebView: ${navigator.userAgent}`,
    `Screen: ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}`,
    '',
    entries.length ? entries.join('\n') : 'No errors recorded in this session.',
  ].join('\n');
}
