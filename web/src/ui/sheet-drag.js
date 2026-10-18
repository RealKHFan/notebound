// Pull a bottom sheet down to close it, like Android's own sheets.
//
// The sheet follows the finger. Letting go far enough down, or with a quick
// flick, closes it; otherwise it springs back. Inside the scrolling part a
// pull only moves the sheet when that part is already scrolled to the top,
// so long lists still scroll normally. A mouse can drag it by the top bar.

const SLOP = 6; // px before deciding between "drag the sheet" and "scroll / tap"
const CLOSE_FRACTION = 0.3; // of the sheet height
const FLICK = 0.5; // px per ms, downward (Material's "significant velocity")
const VELOCITY_WINDOW = 100; // ms of finger movement used to measure speed
const BACK_MS = 220;

export function attachSheetDrag({ sheet, scrim, body, onClose }) {
  let startX = 0;
  let startY = 0;
  let samples = []; // [time, y] of recent moves
  let dy = 0;
  let height = 1;
  let active = false; // a touch or mouse press is down
  let decided = false;
  let dragging = false;
  let fromBody = false;
  let target = null;

  const closing = () => !!sheet.closest('.closing');
  const place = (y, animate) => {
    const t = animate ? `transform ${BACK_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)` : 'none';
    sheet.style.transition = t;
    sheet.style.transform = y > 0 ? `translateY(${y}px)` : '';
    if (scrim) {
      scrim.style.transition = animate ? `opacity ${BACK_MS}ms ease` : 'none';
      scrim.style.opacity = y > 0 ? String(Math.max(0, 1 - y / height)) : '';
    }
  };

  const begin = (x, y, el, time) => {
    if (closing()) return;
    active = true;
    decided = false;
    dragging = false;
    startX = x;
    startY = y;
    samples = [[time, y]];
    dy = 0;
    target = el;
    fromBody = !!(body && el && body.contains(el));
    height = sheet.getBoundingClientRect().height || 1;
  };

  // Returns true while the sheet is being dragged (the caller then stops scrolling).
  const move = (x, y, time) => {
    if (!active) return false;
    const d = y - startY;
    if (!decided) {
      if (Math.abs(d) < SLOP && Math.abs(x - startX) < SLOP) return false;
      decided = true;
      const downward = d > 0 && Math.abs(d) > Math.abs(x - startX);
      const atTop = !fromBody || body.scrollTop <= 0;
      const inText = target && target.closest && target.closest('input, textarea, [contenteditable="true"]');
      dragging = downward && atTop && !inText;
      if (!dragging) { active = false; return false; }
    }
    samples.push([time, y]);
    while (samples.length > 2 && time - samples[0][0] > VELOCITY_WINDOW) samples.shift();
    dy = Math.max(0, d);
    place(dy, false);
    return true;
  };

  // Speed of the finger just before it let go (0 when it rested before lifting).
  const speed = (time) => {
    const [t0, y0] = samples[0];
    const [t1, y1] = samples[samples.length - 1];
    if (time - t1 > VELOCITY_WINDOW || t1 <= t0) return 0;
    return (y1 - y0) / (t1 - t0);
  };

  const end = (time) => {
    if (!active) return;
    active = false;
    if (!dragging) return;
    dragging = false;
    swallowNextClick();
    if (dy > height * CLOSE_FRACTION || (speed(time) > FLICK && dy > 16)) {
      // keep the current position; the closing style takes it from here
      sheet.style.transition = '';
      if (scrim) scrim.style.transition = '';
      onClose();
    } else {
      place(0, true);
    }
  };

  // A finger that dragged the sheet must not also press the button it started on.
  const swallowNextClick = () => {
    const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
    window.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 350);
  };

  const onTouchStart = (e) => {
    if (e.touches.length !== 1) { active = false; return; }
    const t = e.touches[0];
    begin(t.clientX, t.clientY, e.target, e.timeStamp);
  };
  const onTouchMove = (e) => {
    if (!active) return;
    if (e.touches.length !== 1) { end(e.timeStamp); return; }
    const t = e.touches[0];
    if (move(t.clientX, t.clientY, e.timeStamp) && e.cancelable) e.preventDefault();
  };
  const onTouchEnd = (e) => end(e.timeStamp);

  // Mouse: drag by the top bar or title (the list itself is for clicking).
  const onMouseDown = (e) => {
    if (e.button !== 0 || (body && body.contains(e.target))) return;
    begin(e.clientX, e.clientY, e.target, e.timeStamp);
    const mm = (ev) => { if (move(ev.clientX, ev.clientY, ev.timeStamp)) ev.preventDefault(); };
    const mu = (ev) => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); end(ev.timeStamp); };
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
  };

  sheet.addEventListener('touchstart', onTouchStart, { passive: true });
  sheet.addEventListener('touchmove', onTouchMove, { passive: false });
  sheet.addEventListener('touchend', onTouchEnd);
  sheet.addEventListener('touchcancel', onTouchEnd);
  sheet.addEventListener('mousedown', onMouseDown);
  return () => {
    sheet.removeEventListener('touchstart', onTouchStart);
    sheet.removeEventListener('touchmove', onTouchMove);
    sheet.removeEventListener('touchend', onTouchEnd);
    sheet.removeEventListener('touchcancel', onTouchEnd);
    sheet.removeEventListener('mousedown', onMouseDown);
  };
}
