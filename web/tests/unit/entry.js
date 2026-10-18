// Bundled by build.mjs --test into .test-build/units.js; exposes pure modules to the browser tests.
import * as noteFormat from '../../src/store/note-format.js';
import * as recurrence from '../../src/store/recurrence.js';
import * as query from '../../src/store/query.js';
import * as crypto from '../../src/store/crypto.js';
import * as text from '../../src/io/text.js';
import { searchEmoji, emojiForCode } from '../../src/editor/ext/suggestions.js';
import { computeLayout, columnsFor } from '../../src/ui/Masonry.jsx';
import { drawingToSvg, parseDrawing, strokePath } from '../../src/ui/Drawing.jsx';
import * as format from '../../src/ui/format.js';

window.__units = { noteFormat, recurrence, query, crypto, text, emoji: { searchEmoji, emojiForCode }, masonry: { computeLayout, columnsFor }, drawing: { drawingToSvg, parseDrawing, strokePath }, format };
