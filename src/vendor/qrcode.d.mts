// Hand-trimmed to the subset of qrcode-generator's API this app actually
// calls (see qrcode.mjs, vendored from the npm package of the same name —
// MIT licensed, Kazuhiko Arase). The upstream .d.ts targets a
// `declare module "qrcode-generator"` ambient import, which doesn't match
// how this file is imported (a relative "./qrcode.mjs" path), so this is a
// standalone rewrite rather than a copy of the upstream declaration file.

export type TypeNumber =
  | 0
  | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20
  | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30
  | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40;

export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

export interface QRCode {
  addData(data: string): void;
  make(): void;
  createSvgTag(opts?: { cellSize?: number; margin?: number; scalable?: boolean }): string;
}

export interface QRCodeFactory {
  (typeNumber: TypeNumber, errorCorrectionLevel: ErrorCorrectionLevel): QRCode;
}

declare const qrcode: QRCodeFactory;
export default qrcode;
