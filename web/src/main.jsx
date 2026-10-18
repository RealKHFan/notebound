import './polyfills.js';
import { render } from 'preact';
import '@fontsource-variable/instrument-sans/index.css';
import '@fontsource-variable/instrument-sans/wght-italic.css';
import '@fontsource-variable/newsreader/index.css';
import '@fontsource-variable/newsreader/opsz-italic.css';
import '@fontsource-variable/jetbrains-mono/index.css';
import 'katex/dist/katex.min.css';
import './styles/app.css';
import './styles/editor.css';
import { App } from './ui/App.jsx';
import { boot, installHostEvents } from './ui/app-state.js';
import { installErrorLog } from './ui/diagnostics.js';
import { patternCss } from './store/note-format.js';

installErrorLog();
const patterns = document.createElement('style');
patterns.textContent = patternCss();
document.head.appendChild(patterns);
installHostEvents();
// Links never navigate the app page; notes open them through the link bubble or in read-only mode.
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href]');
  if (a && !e.defaultPrevented) e.preventDefault();
});
render(<App />, document.getElementById('app'));
boot();

// Exposed for automated tests only (harmless in the app: everything is local).
window.__notebound = { version: __APP_VERSION__ };
