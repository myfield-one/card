// Trimmed to the subset of tesseract.js's API this app actually calls.
// Loaded via a plain <script> tag (see ocr.ts) rather than an ES import —
// its dist/tesseract.esm.min.js is a minified CJS-interop wrapper whose
// property names aren't guaranteed stable to import against, whereas the
// UMD build's documented `window.Tesseract` global is tesseract.js's own
// supported non-module entry point. MIT... actually Apache-2.0 licensed,
// see README.md's Acknowledgments.

declare namespace Tesseract {
  interface Bbox {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }
  interface Line {
    text: string;
    bbox: Bbox;
  }
  interface Paragraph {
    lines: Line[];
  }
  interface Block {
    paragraphs: Paragraph[];
  }
  interface Page {
    blocks: Block[] | null;
    text: string;
  }
  interface RecognizeResult {
    data: Page;
  }
  interface LoggerMessage {
    status: string;
    progress: number;
  }
  interface WorkerOptions {
    workerPath: string;
    corePath: string;
    langPath: string;
    gzip: boolean;
    workerBlobURL: boolean;
    logger: (message: LoggerMessage) => void;
  }
  interface WorkerParams {
    tessedit_pageseg_mode: string;
  }
  interface OutputFormats {
    blocks: boolean;
  }
  interface Worker {
    setParameters(params: Partial<WorkerParams>): Promise<unknown>;
    // recognize() only computes/returns the output formats explicitly
    // requested here — `data.blocks` is `null` unless `{ blocks: true }` is
    // passed, regardless of image content or page segmentation mode. See
    // ocr.ts's recognizeCardImage for why this matters.
    recognize(image: string, options?: Record<string, never>, output?: Partial<OutputFormats>): Promise<RecognizeResult>;
    terminate(): Promise<unknown>;
  }
  function createWorker(langs: string[], oem: number, options: Partial<WorkerOptions>): Promise<Worker>;
}

interface Window {
  Tesseract?: typeof Tesseract;
}
