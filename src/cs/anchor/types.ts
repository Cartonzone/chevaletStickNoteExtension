/**
 * What a note remembers about where it was stuck. Plan section 5.
 *
 * Three tiers are captured every time, regardless of the mode the user picked, because a pure
 * document coordinate is worthless on any page with dynamic content and an element selector is
 * worthless on any page whose markup churns. The resolver tries them in order of how much it
 * trusts them and keeps the best answer.
 */

/** One step of a structural path. `shadow` means "descend into this element's open shadow root". */
export interface PathSegment {
  tag: string;
  nth: number;
  shadow?: true;
}

export interface DocAnchor {
  /** Document coordinates at capture time. */
  x: number;
  y: number;
  /** The same point as a fraction of the document, for surviving a width change. */
  fx: number;
  fy: number;
  docW: number;
  docH: number;
  dir: 'ltr' | 'rtl';
}

export interface ElementAnchor {
  path: PathSegment[];
  /** Only recorded when the id looks stable -- see `looksStable`. */
  stableId?: string;
  testId?: string;
  tag: string;
  /** Offset from the element's border box, in pixels and as a fraction of its size. */
  dx: number;
  dy: number;
  rx: number;
  ry: number;
  w: number;
  h: number;
}

export interface TextAnchor {
  quote: { exact: string; prefix: string; suffix: string };
  position: { start: number; end: number };
}

export type AnchorMode = 'document' | 'element' | 'text' | 'pinned';

export interface Anchor {
  mode: AnchorMode;
  doc: DocAnchor;
  el?: ElementAnchor;
  text?: TextAnchor;
  pin?: { vx: number; vy: number };
  /**
   * Where this anchor RESOLVED TO at the moment it was captured.
   *
   * Not the same thing as `doc.x`/`doc.y`, and the difference is the bug this field was added
   * to fix. `doc` is the point the note was put at; `ref` is the point the resolver answers
   * with when asked about that anchor. The text tier, which usually wins, answers with the
   * corner of the quoted run -- a hundred-odd pixels from where the person actually dropped
   * the paper. So a resolution is not a position, and treating it as one moved every note on
   * every load.
   *
   * With `ref` stored, the resolver's answer is only ever read as a DIFFERENCE: how far the
   * thing this note is stuck to has moved since. That difference is applied to the note's own
   * stored coordinates, which means an unchanged page moves nothing at all and a page that
   * reflowed moves the note by exactly as much as its content moved.
   *
   * Optional because notes written before 0.0.17 do not have one. They are placed at their
   * stored coordinates and pick a `ref` up the first time they are moved -- see `placeFor`.
   */
  ref?: { x: number; y: number };
}

/** How the resolver did, and how much it trusts the answer. */
export interface Resolution {
  x: number;
  y: number;
  confidence: number;
  /** Which tier produced the answer -- shown in the UI and logged by the anchoring corpus. */
  via: 'stableId' | 'testId' | 'path' | 'quote' | 'fuzzy' | 'position' | 'fraction' | 'raw';
  /** The element or range the note is now attached to, when there is one. */
  target?: Element;
  range?: Range;
}

/** Below this the note is treated as orphaned: shown, flagged, never silently misplaced. */
export const ORPHAN_BELOW = 0.35;
/** At or above this the resolver stops looking. */
export const GOOD_ENOUGH = 0.65;
