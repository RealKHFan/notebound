// Small popup list used by the "/" commands, ":" emoji and "[[" note links.
// Plain DOM so it works inside the editor without a framework.

export function createSuggestionRenderer({ renderItem, className = '', emptyText = 'No matches' }) {
  return () => {
    let el = null;
    let props = null;
    let index = 0;

    const place = () => {
      if (!el || !props?.clientRect) return;
      const rect = props.clientRect();
      if (!rect) return;
      const vv = window.visualViewport;
      const vh = vv ? vv.height + vv.offsetTop : window.innerHeight;
      const vw = window.innerWidth;
      const bottomInset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--toolbar-h')) || 0;
      el.style.maxHeight = '';
      const h = Math.min(el.scrollHeight, 280);
      const w = Math.min(320, vw - 16);
      let left = Math.min(Math.max(8, rect.left), vw - w - 8);
      const spaceBelow = vh - bottomInset - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      let top;
      if (spaceBelow >= Math.min(h, 160) || spaceBelow >= spaceAbove) {
        top = rect.bottom + 6;
        el.style.maxHeight = `${Math.max(120, Math.min(280, spaceBelow - 6))}px`;
      } else {
        const hh = Math.min(h, spaceAbove - 6);
        top = rect.top - hh - 6;
        el.style.maxHeight = `${Math.max(120, hh)}px`;
      }
      el.style.left = `${left}px`;
      el.style.top = `${Math.max(8, top)}px`;
      el.style.width = `${w}px`;
    };

    const draw = () => {
      if (!el) return;
      el.innerHTML = '';
      const items = props.items || [];
      el.style.display = !items.length && emptyText === null ? 'none' : '';
      if (!items.length && emptyText !== null) {
        const empty = document.createElement('div');
        empty.className = 'suggest-empty';
        empty.textContent = emptyText;
        el.appendChild(empty);
      }
      items.forEach((item, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'suggest-item' + (i === index ? ' active' : '');
        b.setAttribute('role', 'option');
        b.setAttribute('aria-selected', i === index ? 'true' : 'false');
        b.innerHTML = renderItem(item);
        // mousedown/touch must not steal focus from the editor
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('pointerdown', (e) => e.preventDefault());
        b.addEventListener('click', (e) => {
          e.preventDefault();
          select(i);
        });
        el.appendChild(b);
      });
      place();
      el.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    };

    const select = (i) => {
      const item = props?.items?.[i];
      if (item) props.command(item);
    };

    return {
      onStart(p) {
        props = p;
        index = 0;
        el = document.createElement('div');
        el.className = 'suggest-menu ' + className;
        el.setAttribute('role', 'listbox');
        document.body.appendChild(el);
        draw();
      },
      onUpdate(p) {
        props = p;
        if (index >= (p.items?.length || 0)) index = 0;
        draw();
      },
      onKeyDown({ event }) {
        const n = props?.items?.length || 0;
        if (event.key === 'Escape') {
          el?.remove();
          el = null;
          return true;
        }
        if (!n) return false;
        if (event.key === 'ArrowDown') { index = (index + 1) % n; draw(); return true; }
        if (event.key === 'ArrowUp') { index = (index - 1 + n) % n; draw(); return true; }
        if (event.key === 'Enter' || event.key === 'Tab') { select(index); return true; }
        return false;
      },
      onExit() {
        el?.remove();
        el = null;
        props = null;
      },
    };
  };
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
