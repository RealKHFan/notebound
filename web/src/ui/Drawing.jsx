// Finger and stylus drawing. Saved as an SVG file (opens anywhere) that also
// carries the stroke data, so the drawing can be edited again later.
import { useEffect, useRef, useState } from 'preact/hooks';
import { getStroke } from 'perfect-freehand';
import { Icon } from './icons.jsx';
import { popPage, ask, useBackHandler } from './app-state.js';
import { native } from '../native.js';

export const DRAW_COLORS = ['#1d1f24', '#6b7280', '#e5484d', '#f76b15', '#ffc53d', '#30a46c', '#0090ff', '#8e4ec6', '#d6409f', '#8d6e63'];
const SIZES = [3, 6, 12];

function avg(a, b) { return (a + b) / 2; }
export function strokePath(points) {
  const len = points.length;
  if (!len) return '';
  if (len < 4) {
    const [x, y] = points[0];
    return `M${x - 1},${y} a1,1 0 1,0 2,0 a1,1 0 1,0 -2,0`;
  }
  let a = points[0];
  let b = points[1];
  const c = points[2];
  let d = `M${a[0].toFixed(1)},${a[1].toFixed(1)} Q${b[0].toFixed(1)},${b[1].toFixed(1)} ${avg(b[0], c[0]).toFixed(1)},${avg(b[1], c[1]).toFixed(1)} T`;
  for (let i = 2; i < len - 1; i++) {
    a = points[i];
    b = points[i + 1];
    d += `${avg(a[0], b[0]).toFixed(1)},${avg(a[1], b[1]).toFixed(1)} `;
  }
  return d + 'Z';
}

function outline(s) {
  return getStroke(s.points, {
    size: s.tool === 'marker' ? s.size * 2.6 : s.size,
    thinning: s.tool === 'marker' ? 0 : 0.55,
    smoothing: 0.5,
    streamline: 0.45,
    simulatePressure: !s.pen,
    last: true,
  });
}

export function drawingToSvg(strokes, w, h, bg = null) {
  const paths = strokes.map((s) => `<path d="${strokePath(outline(s))}" fill="${s.color}"${s.tool === 'marker' ? ' fill-opacity="0.35"' : ''}/>`).join('\n');
  const data = JSON.stringify({ v: 1, w, h, strokes, bg: bg ? { w: bg.w, h: bg.h } : undefined }).replace(/</g, '\\u003c').replace(/--/g, '-\\u002d');
  // A picture the drawing was made on top of is embedded, so the file stays complete on its own.
  const under = bg ? `<image href="${bg.href}" x="0" y="0" width="${Math.round(bg.w)}" height="${Math.round(bg.h)}" preserveAspectRatio="xMidYMid meet"/>\n` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(w)} ${Math.round(h)}" width="${Math.round(w)}" height="${Math.round(h)}">
<metadata id="notebound-drawing"><![CDATA[${data}]]></metadata>
<rect width="100%" height="100%" fill="#ffffff"/>
${under}${paths}
</svg>
`;
}

export function parseDrawing(svgText) {
  // pocketbook-drawing: drawings from the first builds (named Pocketbook)
  const m = /<metadata id="(?:notebound|pocketbook)-drawing"><!\[CDATA\[([\s\S]*?)\]\]><\/metadata>/.exec(svgText || '');
  if (!m) return null;
  try {
    const d = JSON.parse(m[1]);
    if (!Array.isArray(d.strokes)) return null;
    const img = /<image href="(data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+)"/.exec(svgText);
    if (d.bg && img) d.bg = { href: img[1], w: Number(d.bg.w) || d.w, h: Number(d.bg.h) || d.h };
    else delete d.bg;
    return d;
  } catch {
    return null;
  }
}

function hitStroke(s, x, y, r) {
  for (const p of s.points) if (Math.hypot(p[0] - x, p[1] - y) <= r + s.size) return true;
  return false;
}

export function DrawingPage({ page }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(DRAW_COLORS[0]);
  const [size, setSize] = useState(SIZES[1]);
  const [strokes, setStrokes] = useState([]);
  const [redo, setRedo] = useState([]);
  const [dims, setDims] = useState(null);
  const [baseImage, setBaseImage] = useState(null);
  const current = useRef(null);
  const active = useRef(new Set());
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const changed = useRef(false);
  const finished = useRef(false);

  // When the keyboard closes after the page opened, give the canvas the new room.
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      setDims((d) => (d && (el.clientWidth > d.w || el.clientHeight > d.h)
        ? { ...d, w: Math.max(d.w, el.clientWidth), h: Math.max(d.h, el.clientHeight) } : d));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    document.activeElement?.blur?.();
    const el = wrap.current;
    const w = el.clientWidth;
    const h = el.clientHeight;
    (async () => {
      if (page.src) {
        const text = await native.read(page.src).catch(() => null);
        const d = parseDrawing(text);
        if (d) {
          // fit the old drawing into the current screen
          const k = Math.min(w / d.w, h / d.h, 1);
          setStrokes(d.strokes.map((s) => ({ ...s, points: s.points.map((p) => [p[0] * k, p[1] * k, p[2]]), size: s.size * k })));
          if (d.bg) setBaseImage({ href: d.bg.href, w: d.bg.w * k, h: d.bg.h * k });
          setDims({ w, h, k });
          return;
        }
        // A picture from elsewhere: draw on top of it.
        setBaseImage({ path: page.src, href: '/vault/' + page.src.split('/').map(encodeURIComponent).join('/'), w, h });
      }
      setDims({ w, h, k: 1 });
    })();
    return () => {
      if (!finished.current) page.onCancel?.();
    };
  }, []);

  // redraw
  useEffect(() => {
    const c = canvas.current;
    if (!c || !dims) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(dims.w * dpr);
    c.height = Math.round(dims.h * dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, dims.w, dims.h);
    const all = current.current ? [...strokes, current.current] : strokes;
    for (const s of all) {
      ctx.globalAlpha = s.tool === 'marker' ? 0.35 : 1;
      ctx.fillStyle = s.color;
      ctx.fill(new Path2D(strokePath(outline(s))));
    }
    ctx.globalAlpha = 1;
  });
  const [, force] = useState(0);
  const repaint = () => force((x) => x + 1);

  const pt = (e) => {
    const r = canvas.current.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top, e.pressure || 0.5];
  };
  const eraseAt = (x, y) => {
    const keep = strokesRef.current.filter((s) => !hitStroke(s, x, y, 10));
    if (keep.length !== strokesRef.current.length) {
      setRedo([]);
      setStrokes(keep);
      changed.current = true;
    }
  };
  const down = (e) => {
    active.current.add(e.pointerId);
    if (active.current.size > 1) { current.current = null; repaint(); return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pt(e);
    if (tool === 'eraser') { eraseAt(p[0], p[1]); return; }
    current.current = { tool, color, size, pen: e.pointerType === 'pen', points: [p] };
    repaint();
  };
  const move = (e) => {
    if (!active.current.has(e.pointerId) || active.current.size > 1) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (tool === 'eraser') { for (const ev of events) { const p = pt(ev); eraseAt(p[0], p[1]); } return; }
    if (!current.current) return;
    for (const ev of events) current.current.points.push(pt(ev));
    repaint();
  };
  const up = (e) => {
    active.current.delete(e.pointerId);
    const s = current.current;
    current.current = null;
    if (s && s.points.length) {
      s.points = s.points.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, Math.round(p[2] * 100) / 100]);
      setStrokes([...strokesRef.current, s]);
      setRedo([]);
      changed.current = true;
    } else repaint();
  };

  const undo = () => {
    if (!strokes.length) return;
    setRedo([...redo, strokes[strokes.length - 1]]);
    setStrokes(strokes.slice(0, -1));
    changed.current = true;
  };
  const redoIt = () => {
    if (!redo.length) return;
    setStrokes([...strokes, redo[redo.length - 1]]);
    setRedo(redo.slice(0, -1));
    changed.current = true;
  };

  const done = async () => {
    finished.current = true;
    if (!strokes.length && !baseImage) { page.onCancel?.(); popPage(); return; }
    let bg = null;
    if (baseImage) {
      let href = baseImage.href;
      if (baseImage.path) {
        // embed the picture itself so the drawing file does not depend on another file
        const b64 = await native.readBase64(baseImage.path).catch(() => null);
        const ext = (baseImage.path.split('.').pop() || '').toLowerCase();
        const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }[ext] || 'image/png';
        href = b64 ? `data:${mime};base64,${b64}` : null;
      }
      if (href) bg = { href, w: baseImage.w, h: baseImage.h };
    }
    const svg = drawingToSvg(strokes, dims.w, dims.h, bg);
    page.onDone?.({ svg, width: Math.round(dims.w), height: Math.round(dims.h) });
    popPage();
  };
  const cancel = async () => {
    if (changed.current && strokes.length) {
      const ok = await ask({ title: 'Discard this drawing?', confirm: 'Discard', danger: true });
      if (!ok) return;
    }
    popPage();
  };
  useBackHandler(() => { cancel(); return true; });

  return (
    <div class="draw" role="dialog" aria-label="Drawing">
      <div class="page-top">
        <button class="icon-btn" onClick={cancel} aria-label="Discard drawing"><Icon name="x" /></button>
        <h1>Drawing</h1>
        <button class="icon-btn" onClick={undo} disabled={!strokes.length} aria-label="Undo stroke"><Icon name="undo" /></button>
        <button class="icon-btn" onClick={redoIt} disabled={!redo.length} aria-label="Redo stroke"><Icon name="redo" /></button>
        <button class="icon-btn" onClick={async () => { if (strokes.length && await ask({ title: 'Clear the whole drawing?', confirm: 'Clear', danger: true })) { setRedo([]); setStrokes([]); changed.current = true; } }} aria-label="Clear drawing"><Icon name="trash" /></button>
        <button class="btn primary" style={{ marginRight: '6px' }} onClick={done} aria-label="Save drawing"><Icon name="check" size={20} /> Done</button>
      </div>
      <div class="draw-canvas-wrap" ref={wrap}>
        {baseImage ? <img src={baseImage.href} alt="" style={{ position: 'absolute', left: 0, top: 0, width: `${baseImage.w}px`, height: `${baseImage.h}px`, objectFit: 'contain', background: '#fff' }} /> : null}
        <canvas
          ref={canvas}
          style={dims ? { width: `${dims.w}px`, height: `${dims.h}px` } : null}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          aria-label="Drawing canvas"
        />
      </div>
      {tool !== 'eraser' ? (
        <div class="draw-colors" role="radiogroup" aria-label="Pen color">
          {DRAW_COLORS.map((c) => (
            <button key={c} role="radio" aria-checked={c === color ? 'true' : 'false'} class={c === color ? 'on' : ''} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => setColor(c)} />
          ))}
        </div>
      ) : null}
      <div class="draw-tools">
        <button class={'icon-btn' + (tool === 'pen' ? ' on' : '')} onClick={() => setTool('pen')} aria-label="Pen" aria-pressed={tool === 'pen' ? 'true' : 'false'}><Icon name="pen" /></button>
        <button class={'icon-btn' + (tool === 'marker' ? ' on' : '')} onClick={() => setTool('marker')} aria-label="Marker" aria-pressed={tool === 'marker' ? 'true' : 'false'}><Icon name="highlight" /></button>
        <button class={'icon-btn' + (tool === 'eraser' ? ' on' : '')} onClick={() => setTool('eraser')} aria-label="Eraser" aria-pressed={tool === 'eraser' ? 'true' : 'false'}><Icon name="eraser" /></button>
        <div class="draw-sizes" role="radiogroup" aria-label="Stroke size">
          {SIZES.map((s) => (
            <button key={s} role="radio" aria-checked={s === size ? 'true' : 'false'} class={s === size ? 'on' : ''} onClick={() => setSize(s)} aria-label={`Size ${s}`}>
              <span style={{ width: `${s + 2}px`, height: `${s + 2}px` }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
