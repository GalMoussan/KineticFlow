/** Shared state of the brutalist traits (`layout/brutal-grid` writes it; `reveal/brutal-snap`, `material/brutal-ink` read it). */

/** `unit.data.layout` of brutal-grid decorations and rows. */
export type BrutalData =
  /** Giant cropped copy of content unit `of` (its `i`-th landing in the section), on the full-frame `flash` panel. */
  | { kind: 'giant'; of: number; i: number }
  | { kind: 'flash'; of: number; i: number }
  /** Full-width rule growing from the start edge at `at`. */
  | { kind: 'rule'; at: number }
  /** Mono slug line (section number / time code) and the giant cropped section number. */
  | { kind: 'label' }
  | { kind: 'mark' }
  /** A content row. */
  | { kind: 'row'; row: number };
