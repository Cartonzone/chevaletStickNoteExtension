/**
 * Capture and resolution. Plan section 5.
 *
 * Capture always records all three tiers. Resolution walks them in order of trust and stops as
 * soon as something clears the bar, so the common case -- an unchanged page -- costs one
 * `getElementById` and never builds a text index at all.
 */

import {
  captureElement,
  idConfidence,
  pickAnchorElement,
  pointFromElement,
  resolvePath,
  resolveTestId,
} from './element.ts';
import type { TextIndex } from './text.ts';
import {
  buildTextIndex,
  captureCaret,
  captureText,
  findQuote,
  overlapAt,
  rangeAt,
} from './text.ts';
import { type Anchor, GOOD_ENOUGH, ORPHAN_BELOW, type Resolution } from './types.ts';

export type { TextIndex } from './text.ts';
export { buildTextIndex } from './text.ts';
export * from './types.ts';

// --------------------------------------------------------------------- capture

function docMetrics() {
  const de = document.documentElement;
  return {
    docW: Math.max(de.scrollWidth, de.clientWidth, 1),
    docH: Math.max(de.scrollHeight, de.clientHeight, 1),
    dir: (getComputedStyle(de).direction === 'rtl' ? 'rtl' : 'ltr') as 'ltr' | 'rtl',
  };
}

/**
 * Capture an anchor at a point in DOCUMENT coordinates.
 *
 * `index` is optional: pass one when capturing several notes at once, otherwise a throwaway
 * index is built. Capturing is rare (once per note) so the cost is not on any hot path.
 *
 * Every anchor leaves here already resolved once, with the answer in `ref`. That is what
 * makes the resolver's output usable as a displacement rather than as a position -- read the
 * comment on `Anchor.ref`, which is the whole of the fix released in 0.0.17. It costs one
 * resolution against an index this function has usually built anyway.
 */
export function captureAt(docX: number, docY: number, index?: TextIndex): Anchor {
  const { docW, docH, dir } = docMetrics();
  const anchor: Anchor = {
    mode: 'document',
    doc: { x: docX, y: docY, fx: docX / docW, fy: docY / docH, docW, docH, dir },
  };

  const vx = docX - window.scrollX;
  const vy = docY - window.scrollY;

  // Built at most once, and only if something asks for it: an anchor with no text tier never
  // needs a text index, and walking the document for one would be the most expensive thing
  // in this function.
  let idx = index;
  const getIndex = (): TextIndex => (idx ??= buildTextIndex());

  const el = pickAnchorElement(vx, vy);
  if (el) anchor.el = captureElement(el, docX, docY);

  const caret = caretAt(vx, vy);
  if (caret) {
    const text = captureCaret(getIndex(), caret.node, caret.offset);
    if (text) anchor.text = text;
  }
  anchor.ref = referencePoint(anchor, getIndex);
  return anchor;
}

/** Capture an anchor for a selected range -- the "stick a note to this sentence" path. */
export function captureSelection(range: Range, index?: TextIndex): Anchor | null {
  const rects = range.getClientRects();
  const first = rects[0];
  if (!first) return null;

  const docX = first.left + window.scrollX;
  const docY = first.bottom + window.scrollY;
  const { docW, docH, dir } = docMetrics();

  const idx = index ?? buildTextIndex();
  const text = captureText(idx, range);
  if (!text) return null;

  const anchor: Anchor = {
    mode: 'text',
    doc: { x: docX, y: docY, fx: docX / docW, fy: docY / docH, docW, docH, dir },
    text,
  };
  const container =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement;
  if (container) anchor.el = captureElement(container, docX, docY);
  anchor.ref = referencePoint(anchor, () => idx);
  return anchor;
}

/**
 * Resolve a just-captured anchor, so the note has something to measure the page against.
 *
 * Deliberately the SAME call the renderer will make on the next load: a reference point
 * produced any other way would drift from it, and the whole value of this number is that on
 * an unchanged page the two are identical and the note does not move at all.
 */
function referencePoint(anchor: Anchor, getIndex: () => TextIndex): { x: number; y: number } {
  const r = resolveAnchor(anchor, { getIndex });
  return { x: r.x, y: r.y };
}

function caretAt(vx: number, vy: number): { node: Node; offset: number } | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  // Firefox has caretPositionFromPoint; Chromium had caretRangeFromPoint first. Try both.
  const pos = d.caretPositionFromPoint?.(vx, vy);
  if (pos) return { node: pos.offsetNode, offset: pos.offset };
  const r = d.caretRangeFromPoint?.(vx, vy);
  if (r) return { node: r.startContainer, offset: r.startOffset };
  return null;
}

// -------------------------------------------------------------------- resolve

export interface ResolveOptions {
  /** Reuse one index across a batch of notes. Built lazily if omitted. */
  index?: TextIndex;
  /** Called at most once per batch, so the index is only built if some note needs it. */
  getIndex?: () => TextIndex;
}

/**
 * Find where a note should be now.
 *
 * Candidates are scored rather than short-circuited on the first hit, because the cheap tiers
 * are also the least reliable: a structural path that still resolves may well be pointing at
 * a completely different paragraph after a list re-order.
 */
export function resolveAnchor(anchor: Anchor, opts: ResolveOptions = {}): Resolution {
  if (anchor.mode === 'pinned' && anchor.pin) {
    return { x: anchor.pin.vx, y: anchor.pin.vy, confidence: 1, via: 'raw' };
  }

  const candidates: Resolution[] = [];
  const push = (r: Resolution | null): boolean => {
    if (!r) return false;
    candidates.push(r);
    return r.confidence >= GOOD_ENOUGH;
  };

  const a = anchor.el;
  if (a) {
    if (a.stableId) {
      const el = document.getElementById(a.stableId);
      if (el && el.tagName.toLowerCase() === a.tag) {
        const confidence = idConfidence(a.stableId);
        if (push({ ...pointFromElement(el, a), confidence, via: 'stableId', target: el })) {
          return best(candidates);
        }
      }
    }
    if (a.testId) {
      const el = resolveTestId(a.testId);
      if (el) {
        if (push({ ...pointFromElement(el, a), confidence: 0.95, via: 'testId', target: el })) {
          return best(candidates);
        }
      }
    }
    const el = resolvePath(a.path);
    if (el) {
      // A path that resolves to a different tag is a path that resolved to the wrong thing.
      const conf = el.tagName.toLowerCase() === a.tag ? 0.9 : 0.5;
      push({ ...pointFromElement(el, a), confidence: conf, via: 'path', target: el });
    }
  }

  if (anchor.text) {
    const index = opts.index ?? opts.getIndex?.() ?? buildTextIndex();
    const hit = findQuote(index, anchor.text);
    if (hit) {
      const range = rangeAt(index, hit.start, hit.end);
      const point = range ? pointOfRange(range) : null;
      if (point) {
        // An exact quote outranks a structural path; a fuzzy one sits just below it.
        const confidence = hit.exact ? Math.min(0.92, hit.score * 0.92) : hit.score;
        push({
          ...point,
          confidence,
          via: hit.exact ? 'quote' : 'fuzzy',
          ...(range ? { range } : {}),
        });
      }
    } else {
      const overlap = overlapAt(index, anchor.text);
      if (overlap >= 0.6) {
        const range = rangeAt(index, anchor.text.position.start, anchor.text.position.end);
        const point = range ? pointOfRange(range) : null;
        if (point)
          push({ ...point, confidence: 0.5, via: 'position', ...(range ? { range } : {}) });
      }
    }
  }

  // Document fallbacks. Always available, never trusted.
  const { docW, docH } = docMetrics();
  const widthChanged = Math.abs(docW - anchor.doc.docW) / Math.max(1, anchor.doc.docW) > 0.05;
  const heightChanged = Math.abs(docH - anchor.doc.docH) / Math.max(1, anchor.doc.docH) > 0.05;
  push({
    x: widthChanged ? anchor.doc.fx * docW : anchor.doc.x,
    y: heightChanged ? anchor.doc.fy * docH : anchor.doc.y,
    confidence: widthChanged || heightChanged ? 0.35 : 0.6,
    via: widthChanged || heightChanged ? 'fraction' : 'raw',
  });

  return best(candidates);
}

/**
 * Where a note goes now, given where it was left and what its anchor says today.
 *
 * ## The bug this exists to prevent
 *
 * Reported against every release up to 0.0.16: *"when i add a sticky note and place it
 * somewhere the place of that sticky note not saving in that page ever and with refresh note
 * all of them come in default place"*. The position WAS saved --
 * `spikes/firefox-persist.mjs` reads it straight back out of IndexedDB and has always said
 * so. It was read back and then thrown away.
 *
 * The renderer used to take the resolver's answer outright whenever it was confident enough.
 * **A resolution is not a position.** The text tier, which usually wins, answers with the
 * corner of the quoted run of prose; that is where the note's CONTENT is, not where the
 * person dropped the paper, and the two are a hundred-odd pixels apart the moment anyone
 * drags a note anywhere. So every note went back to the neighbourhood it was made in, and
 * the stored coordinates were reached for only when anchoring had failed outright.
 *
 * What the page can honestly report is not where a note belongs. It is **how far the thing
 * the note is stuck to has moved** since the note was put down: `r - anchor.ref`. Applied to
 * the note's own coordinates, that makes an unchanged page move nothing at all, and a page
 * that grew a banner overnight move the note down by the height of the banner -- which is
 * the whole reason anchors exist.
 *
 * `resolve` is injected so the policy can be exercised without a document;
 * `spikes/firefox-place.mjs` measures the same thing from the page, in a real Firefox.
 */
export function placeNote(
  stored: { x: number; y: number },
  anchor: unknown,
  resolve: (a: Anchor) => Resolution = resolveAnchor,
): { x: number; y: number; orphan: boolean } {
  const a = anchor as Anchor | null;
  if (!a || typeof a !== 'object' || !('mode' in a)) return { ...stored, orphan: false };

  /*
   * A note stored before 0.0.17 has no reference point, and one cannot be invented for it:
   * what the resolver says today can be compared with nothing. Its own coordinates are the
   * honest answer -- which is exactly where the person left it -- and it gains a reference
   * the moment it is next moved, after which it follows the page again.
   */
  const ref = a.ref;
  if (!ref || !Number.isFinite(ref.x) || !Number.isFinite(ref.y)) {
    return { ...stored, orphan: false };
  }

  let r: Resolution;
  try {
    r = resolve(a);
  } catch {
    return { ...stored, orphan: false };
  }
  /*
   * Lost its target entirely: left exactly where it was, and said so. Nothing in the UI shows
   * `orphan` yet -- what it buys today is that a note whose anchor has gone is never MOVED on
   * the strength of a guess, which is the half that protects someone's notes.
   */
  if (r.confidence < ORPHAN_BELOW) return { ...stored, orphan: true };
  // Found, but not well enough to trust a displacement measured from it.
  if (r.confidence < GOOD_ENOUGH) return { ...stored, orphan: false };
  return { x: stored.x + (r.x - ref.x), y: stored.y + (r.y - ref.y), orphan: false };
}

function best(candidates: Resolution[]): Resolution {
  let top = candidates[0] as Resolution;
  for (const c of candidates) if (c.confidence > top.confidence) top = c;
  return top;
}

function pointOfRange(range: Range): { x: number; y: number } | null {
  const rects = range.getClientRects();
  const r = rects[0] ?? range.getBoundingClientRect();
  if (!r || (r.width === 0 && r.height === 0)) return null;
  return { x: r.left + window.scrollX, y: r.bottom + window.scrollY };
}
