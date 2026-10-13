// Static model of the two @earendil-works/pi-tui 0.86.0 functions used in this repository
// (extensions/subagent-footer/index.ts, tests/pi-contrats/sonde.ts), for the S4 TypeScript profile only.
// No file imports this declaration and nothing is loaded at run time; under pi the real package is used.
// Verbatim copies, with `export declare` written `export` inside the ambient module, from the pi 0.86.0
// install: dist/utils.d.ts 5c30df25ba321b1d104e49bd3e1eb4d3135c1b031107b8fe86278b83931f9e0b (re-exported
// by dist/index.d.ts). Any other member of the package stays undeclared: importing it is a diagnostic.
declare module "@earendil-works/pi-tui" {
  /**
   * Calculate the visible width of a string in terminal columns.
   */
  export function visibleWidth(str: string): number;
  /**
   * Truncate text to fit within a maximum visible width, adding ellipsis if needed.
   * Optionally pad with spaces to reach exactly maxWidth.
   * Properly handles ANSI escape codes (they don't count toward width).
   *
   * @param text - Text to truncate (may contain ANSI codes)
   * @param maxWidth - Maximum visible width
   * @param ellipsis - Ellipsis string to append when truncating (default: "...")
   * @param pad - If true, pad result with spaces to exactly maxWidth (default: false)
   * @returns Truncated text, optionally padded to exactly maxWidth
   */
  export function truncateToWidth(text: string, maxWidth: number, ellipsis?: string, pad?: boolean): string;
}
