// Icons from Lucide (ISC license), bundled locally.
import {
  Menu, Search, LayoutGrid, Rows3, Plus, SquareCheckBig, Brush, Image, Images, Camera, Pin, PinOff, Bell, BellRing,
  BellOff, Archive, ArchiveRestore, Trash2, Undo2, Redo2, EllipsisVertical, Palette, Tag, Tags, Book, BookOpen,
  Notebook, Star, Lock, LockOpen, Settings, ArrowLeft, X, Check, ChevronRight, ChevronDown, ChevronUp, ChevronLeft,
  Bold, Italic, Underline, Strikethrough, Highlighter, Baseline, Heading1, Heading2, Heading3, Heading4, Pilcrow,
  List, ListOrdered, ListChecks, Quote, Code, SquareCode, Table, Sigma, Link, Unlink, Paperclip, Minus,
  ChevronsDownUp, Info, TriangleAlert, CircleCheck, OctagonAlert, Lightbulb, Smile, Replace, ListTree, History,
  Copy, Share2, Download, FileText, Eye, EyeOff, PencilOff, IndentIncrease, IndentDecrease, AlignLeft, AlignCenter,
  AlignRight, AlignJustify, Subscript, Superscript, Calendar, Clock, Repeat, Sun, Moon, Folder, FolderOpen, Upload,
  RefreshCw, Eraser, PenLine, Type, Keyboard, KeyboardOff, GripVertical, CircleHelp, Fingerprint, ShieldCheck,
  FileDown, FileUp, Hash, CalendarClock, AlarmClock, Square, Shapes, Droplet, Pen, Maximize2, RotateCcw,
  NotebookPen, FolderPlus, Ellipsis, ArrowUpDown, CornerDownRight, ExternalLink, Columns3, Rows2, Merge, Split,
  CaseSensitive, SlidersHorizontal, Printer, MoveUp, MoveDown, WrapText, ALargeSmall, Ban, Heart, ZoomIn, ZoomOut,
  SquarePen, FileInput, FileOutput, Hand, Spline, Scale,
} from 'lucide';

const ICONS = {
  menu: Menu, search: Search, grid: LayoutGrid, rows: Rows3, plus: Plus, checklist: SquareCheckBig, brush: Brush,
  image: Image, images: Images, camera: Camera, pin: Pin, 'pin-off': PinOff, bell: Bell, 'bell-ring': BellRing,
  'bell-off': BellOff, archive: Archive, unarchive: ArchiveRestore, trash: Trash2, undo: Undo2, redo: Redo2,
  more: EllipsisVertical, palette: Palette, tag: Tag, tags: Tags, book: Book, 'book-open': BookOpen, notebook: Notebook,
  star: Star, lock: Lock, unlock: LockOpen, settings: Settings, back: ArrowLeft, x: X, check: Check,
  'chevron-right': ChevronRight, 'chevron-down': ChevronDown, 'chevron-up': ChevronUp, 'chevron-left': ChevronLeft,
  bold: Bold, italic: Italic, underline: Underline, strike: Strikethrough, highlight: Highlighter, 'text-color': Baseline,
  h1: Heading1, h2: Heading2, h3: Heading3, h4: Heading4, paragraph: Pilcrow, 'list-bullet': List,
  'list-ordered': ListOrdered, 'list-checks': ListChecks, quote: Quote, code: Code, 'code-block': SquareCode,
  table: Table, math: Sigma, link: Link, unlink: Unlink, paperclip: Paperclip, minus: Minus, details: ChevronsDownUp,
  info: Info, warning: TriangleAlert, success: CircleCheck, danger: OctagonAlert, tip: Lightbulb, smile: Smile,
  replace: Replace, outline: ListTree, history: History, copy: Copy, share: Share2, download: Download,
  file: FileText, eye: Eye, 'eye-off': EyeOff, 'pencil-off': PencilOff, indent: IndentIncrease, outdent: IndentDecrease,
  'align-left': AlignLeft, 'align-center': AlignCenter, 'align-right': AlignRight, 'align-justify': AlignJustify,
  subscript: Subscript, superscript: Superscript, calendar: Calendar, clock: Clock, repeat: Repeat, sun: Sun,
  moon: Moon, folder: Folder, 'folder-open': FolderOpen, upload: Upload, refresh: RefreshCw, eraser: Eraser,
  pen: PenLine, type: Type, keyboard: Keyboard, 'keyboard-off': KeyboardOff, grip: GripVertical, help: CircleHelp,
  fingerprint: Fingerprint, shield: ShieldCheck, 'file-down': FileDown, 'file-up': FileUp, hash: Hash,
  'calendar-clock': CalendarClock, alarm: AlarmClock, square: Square, shapes: Shapes, droplet: Droplet,
  marker: Pen, maximize: Maximize2, reset: RotateCcw, 'notebook-pen': NotebookPen, 'folder-plus': FolderPlus,
  ellipsis: Ellipsis, sort: ArrowUpDown, 'corner-down-right': CornerDownRight, external: ExternalLink,
  columns: Columns3, 'rows-2': Rows2, merge: Merge, split: Split, 'case': CaseSensitive, sliders: SlidersHorizontal,
  printer: Printer, 'move-up': MoveUp, 'move-down': MoveDown, wrap: WrapText, 'text-size': ALargeSmall, ban: Ban,
  heart: Heart, 'zoom-in': ZoomIn, 'zoom-out': ZoomOut, 'square-pen': SquarePen, 'file-input': FileInput,
  'file-output': FileOutput, hand: Hand, spline: Spline, scale: Scale,
};

export function Icon({ name, size = 22, stroke = 1.8, class: cls = '', title, fill = false }) {
  const node = ICONS[name];
  if (!node) {
    console.warn('missing icon', name);
    return null;
  }
  return (
    <svg
      class={'icon ' + cls}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {node.map(([tag, attrs], i) => {
        const T = tag;
        return <T key={i} {...attrs} />;
      })}
    </svg>
  );
}

/** Same icon as an SVG string, for plain-DOM parts of the editor. */
export function iconSvg(name, size = 20, stroke = 1.8) {
  const node = ICONS[name];
  if (!node) return '';
  const inner = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
