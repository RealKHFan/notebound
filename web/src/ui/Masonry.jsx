// Keep-style staggered grid: each card goes into the currently shortest column.
// Also handles the card gestures: tap, long-press to select, drag to reorder,
// and swipe sideways to archive.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { NoteCard } from './NoteCard.jsx';
import { native } from '../native.js';

const GAP = 8;
const LONG_PRESS_MS = 430;

export function columnsFor(width, layout) {
  if (layout === 'list') return 1;
  if (width >= 1100) return 5;
  if (width >= 860) return 4;
  if (width >= 560) return 3;
  return 2;
}

/** Pure layout: returns positions for ids in order. Exported for tests. */
export function computeLayout(order, heights, cols, width) {
  const colW = (width - GAP * (cols - 1)) / cols;
  const colH = new Array(cols).fill(0);
  const pos = {};
  for (const id of order) {
    let c = 0;
    for (let i = 1; i < cols; i++) if (colH[i] < colH[c] - 0.5) c = i;
    pos[id] = { x: c * (colW + GAP), y: colH[c], w: colW, h: heights[id] || 0 };
    colH[c] += (heights[id] || 0) + GAP;
  }
  return { pos, height: Math.max(0, ...colH) - GAP, colW };
}

export function Masonry({
  entries, layout, selection, lines, onOpen, onToggleSelect, onLongPress, canReorder, onReorder, onSwipe, scrollerRef, showNotebook,
}) {
  const box = useRef(null);
  const [width, setWidth] = useState(0);
  const heights = useRef({});
  const slots = useRef({});
  const posRef = useRef({});
  const drag = useRef(null);
  const gesture = useRef(null);
  const cols = columnsFor(width, layout);
  const ids = entries.map((e) => e.id);
  const selected = new Set(selection);
  const selectionMode = selection.length > 0;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const relayout = (order = ids, cachedHeights = false) => {
    const el = box.current;
    if (!el || !width) return;
    if (!cachedHeights) {
      for (const id of order) {
        const s = slots.current[id];
        if (s) heights.current[id] = s.offsetHeight;
      }
    }
    const { pos, height } = computeLayout(order, heights.current, cols, width);
    posRef.current = pos;
    for (const id of order) {
      const s = slots.current[id];
      const p = pos[id];
      if (!s || !p) continue;
      if (drag.current && drag.current.id === id) continue;
      s.style.transform = `translate(${p.x}px, ${p.y}px)`;
    }
    el.style.height = `${Math.max(0, height)}px`;
  };

  // Measure and place after every render, before paint.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.classList.add('measuring');
    relayout();
    // allow transitions again for later moves
    requestAnimationFrame(() => el.classList.remove('measuring'));
  });

  // Images or fonts can change card heights after the first layout.
  const relayoutRef = useRef(null);
  relayoutRef.current = relayout;
  const ro = useRef(null);
  if (!ro.current && typeof ResizeObserver !== 'undefined') {
    let pending = 0;
    ro.current = new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => { if (!drag.current) relayoutRef.current?.(); });
    });
  }
  useEffect(() => () => ro.current?.disconnect(), []);

  // Block page scrolling while a card is being dragged (touch).
  useEffect(() => {
    const el = box.current;
    const block = (e) => { if (drag.current || gesture.current?.swiping || gesture.current?.long) e.preventDefault(); };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, []);

  const slotFromEvent = (e) => {
    const slot = e.target.closest?.('.card-slot');
    return slot && slot.parentElement === box.current ? slot : null;
  };

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const slot = slotFromEvent(e);
    if (!slot) return;
    const id = slot.dataset.id;
    const g = { id, slot, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, pointerId: e.pointerId, long: false, moved: false, swiping: false };
    g.timer = setTimeout(() => {
      g.long = true;
      native.haptic('long');
      onLongPress?.(id);
    }, LONG_PRESS_MS);
    gesture.current = g;
  };

  const startDrag = (g) => {
    const p = posRef.current[g.id];
    if (!p) return;
    const sc = scrollerRef?.current;
    drag.current = {
      id: g.id, order: [...ids], startX: p.x, startY: p.y, ox: g.x0, oy: g.y0,
      scroll0: sc ? sc.scrollTop : 0, x: g.x0, y: g.y0, raf: 0,
    };
    g.slot.style.zIndex = '10';
    g.slot.classList.add('drag-slot');
    g.slot.firstElementChild?.classList.add('dragging');
    try { box.current.setPointerCapture(g.pointerId); } catch { /* ignore */ }
    // Scroll while the finger rests near the top or bottom edge, faster the closer it gets.
    const tick = () => {
      const d = drag.current;
      if (!d) return;
      const scr = scrollerRef?.current;
      if (scr) {
        const r = scr.getBoundingClientRect();
        const zone = 90;
        let v = 0;
        if (d.y < r.top + zone) v = -Math.ceil(((r.top + zone - d.y) / zone) * 18);
        else if (d.y > r.bottom - zone) v = Math.ceil(((d.y - (r.bottom - zone)) / zone) * 18);
        if (v) {
          const before = scr.scrollTop;
          scr.scrollTop += v;
          if (scr.scrollTop !== before) moveDragged(d);
        }
      }
      d.raf = requestAnimationFrame(tick);
    };
    drag.current.raf = requestAnimationFrame(tick);
  };

  // Place the dragged card under the finger and move the others out of its way.
  const moveDragged = (d) => {
    const slot = slots.current[d.id];
    if (!slot) return;
    const sc = scrollerRef?.current;
    const scrolled = sc ? sc.scrollTop - d.scroll0 : 0;
    slot.style.transform = `translate(${d.startX + (d.x - d.ox)}px, ${d.startY + (d.y - d.oy) + scrolled}px)`;
    const rect = box.current.getBoundingClientRect();
    const px = d.x - rect.left;
    const py = d.y - rect.top;
    for (const id of d.order) {
      if (id === d.id) continue;
      const p = posRef.current[id];
      if (p && px >= p.x && px <= p.x + p.w && py >= p.y && py <= p.y + p.h) {
        const from = d.order.indexOf(d.id);
        const to = d.order.indexOf(id);
        d.order.splice(from, 1);
        d.order.splice(to, 0, d.id);
        relayout(d.order, true);
        break;
      }
    }
  };

  const updateDrag = (e) => {
    const d = drag.current;
    d.x = e.clientX;
    d.y = e.clientY;
    moveDragged(d);
  };

  const endDrag = (commit) => {
    const d = drag.current;
    drag.current = null;
    cancelAnimationFrame(d.raf);
    const slot = slots.current[d.id];
    if (slot) {
      slot.style.zIndex = '';
      slot.classList.remove('drag-slot');
      slot.firstElementChild?.classList.remove('dragging');
    }
    const finalOrder = d.order;
    relayout(commit ? finalOrder : ids);
    if (commit) {
      const i = finalOrder.indexOf(d.id);
      const changed = finalOrder.some((id, k) => id !== ids[k]);
      if (changed) onReorder?.(d.id, finalOrder[i - 1] || null, finalOrder[i + 1] || null);
    }
  };

  const onPointerMove = (e) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    g.x = e.clientX;
    g.y = e.clientY;
    const dx = g.x - g.x0;
    const dy = g.y - g.y0;
    if (drag.current) { updateDrag(e); return; }
    if (g.swiping) {
      g.slot.style.transform = `translate(${(posRef.current[g.id]?.x || 0) + dx}px, ${posRef.current[g.id]?.y || 0}px)`;
      g.slot.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / (g.slot.offsetWidth * 1.2)));
      return;
    }
    if (g.long) {
      if (Math.hypot(dx, dy) > 8 && canReorder) {
        startDrag(g);
        if (drag.current) updateDrag(e);
      }
      return;
    }
    if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.4 && onSwipe && !selectionMode) {
      clearTimeout(g.timer);
      g.swiping = true;
      g.slot.classList.add('swiping');
      try { box.current.setPointerCapture(g.pointerId); } catch { /* ignore */ }
      return;
    }
    if (Math.hypot(dx, dy) > 10) {
      g.moved = true;
      clearTimeout(g.timer);
    }
  };

  const finishSwipe = (g) => {
    const dx = g.x - g.x0;
    const w = g.slot.offsetWidth;
    g.slot.classList.remove('swiping');
    if (Math.abs(dx) > w * 0.42) {
      g.slot.style.transition = 'transform .16s ease, opacity .16s ease';
      g.slot.style.transform = `translate(${(posRef.current[g.id]?.x || 0) + Math.sign(dx) * w * 1.3}px, ${posRef.current[g.id]?.y || 0}px)`;
      g.slot.style.opacity = '0';
      setTimeout(() => {
        g.slot.style.transition = '';
        g.slot.style.opacity = '';
        onSwipe(g.id);
      }, 160);
    } else {
      g.slot.style.opacity = '';
      relayout();
    }
  };

  const onPointerUp = (e) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    clearTimeout(g.timer);
    gesture.current = null;
    if (drag.current) { endDrag(true); return; }
    if (g.swiping) { finishSwipe(g); return; }
    if (g.long || g.moved) return;
    if (selectionMode) onToggleSelect?.(g.id);
    else onOpen?.(g.id);
  };

  const onPointerCancel = () => {
    const g = gesture.current;
    if (!g) return;
    clearTimeout(g.timer);
    gesture.current = null;
    if (drag.current) endDrag(false);
    if (g.swiping) { g.slot.classList.remove('swiping'); g.slot.style.opacity = ''; relayout(); }
  };

  const onKeyDown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const slot = slotFromEvent(e);
    if (!slot) return;
    e.preventDefault();
    if (selectionMode) onToggleSelect?.(slot.dataset.id);
    else onOpen?.(slot.dataset.id);
  };

  const colW = width ? (width - GAP * (cols - 1)) / cols : 0;
  return (
    <div
      ref={box}
      class={'masonry' + (layout === 'list' ? ' list-mode' : '')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={onKeyDown}
    >
      {width ? entries.map((entry) => (
        <div
          key={entry.id}
          class="card-slot"
          data-id={entry.id}
          style={{ width: `${colW}px` }}
          ref={(el) => {
            const prev = slots.current[entry.id];
            if (prev && prev !== el) ro.current?.unobserve(prev);
            if (el) {
              if (prev !== el) ro.current?.observe(el);
              slots.current[entry.id] = el;
            } else delete slots.current[entry.id];
          }}
        >
          <NoteCard entry={entry} selected={selected.has(entry.id)} lines={layout === 'list' ? Math.max(3, Math.round(lines / 2)) : lines} showNotebook={showNotebook} />
        </div>
      )) : null}
    </div>
  );
}
