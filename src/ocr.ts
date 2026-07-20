import type { PhotoTransform } from "./crypto";

// Loads tesseract.js's UMD build via a plain <script> tag rather than an ES
// import of its minified ESM bundle — see vendor/tesseract-global.d.ts for
// why. Nothing here is fetched from a third-party CDN: the engine script,
// worker, wasm core, and language data are all vendored under public/tesseract
// (see README.md's Acknowledgments) and served from this app's own origin.
//
// Must be an absolute, origin-qualified URL (not root-relative) — tesseract.js
// spawns its worker from a `blob:` URL by default (workerBlobURL, to dodge
// cross-origin Worker restrictions), and a worker running from a blob: URL
// has no meaningful "relative to this page" base to resolve a root-relative
// path like "/tesseract/..." against, which surfaces as a
// "URL is not valid or contains user credentials" TypeError when it tries.
const TESS_BASE = `${location.origin}/tesseract`;

let scriptLoadPromise: Promise<void> | null = null;

function loadTesseractScript(): Promise<void> {
  if (window.Tesseract) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${TESS_BASE}/tesseract.min.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load the local OCR engine script"));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

export interface OcrLine {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrProgress {
  status: string;
  progress: number;
}

// The vendored core is the LSTM-only build (tesseract-core-simd-lstm), not
// the legacy+LSTM combined one, so OEM must say so explicitly — the
// "_fast" traineddata this app ships is LSTM-only trained data anyway.
const OEM_LSTM_ONLY = 1;

// `langs` are tesseract.js language codes (e.g. "eng", "chi_sim") — see
// storage.ts's AI_LANGUAGES for the ones this app offers. First call for a
// given language downloads and IndexedDB-caches that language's
// .traineddata.gz (tesseract.js's own caching, not something this app
// re-implements); later calls reuse the cache and skip the network.
async function createTesseractWorker(langs: string[], onProgress?: (p: OcrProgress) => void): Promise<Tesseract.Worker> {
  await loadTesseractScript();
  if (!window.Tesseract) throw new Error("OCR engine failed to load");
  return window.Tesseract.createWorker(langs, OEM_LSTM_ONLY, {
    workerPath: `${TESS_BASE}/worker.min.js`,
    corePath: `${TESS_BASE}/tesseract-core-simd-lstm.js`,
    langPath: `${TESS_BASE}/lang-data`,
    gzip: true,
    // Tesseract.js defaults to fetching workerPath and re-wrapping it as a
    // blob: URL before spawning the Worker, so a cross-origin worker script
    // (e.g. loaded from a CDN) isn't blocked. Everything here is vendored
    // same-origin, so that wrapping is not just unnecessary but actively
    // harmful: the worker then runs with `self.location` pointing at the
    // opaque blob: URL, and the wasm core's own relative-path resolution
    // for its .wasm binary breaks against that non-hierarchical origin,
    // surfacing as "URL is not valid or contains user credentials" from
    // fetch(). Disabling it makes the worker spawn from the real,
    // same-origin workerPath directly.
    workerBlobURL: false,
    logger: (m) => onProgress?.({ status: m.status, progress: m.progress }),
  });
}

// Used by the Settings AI page to force the given languages' engine/core/
// traineddata to download and cache immediately on enabling, rather than
// waiting for the first actual scan — the draft spec calls for the
// download to happen right when the feature is turned on, with its own
// progress UI, not silently deferred to first use.
export async function warmUpOcrLanguages(langs: string[], onProgress?: (p: OcrProgress) => void): Promise<void> {
  const worker = await createTesseractWorker(langs, onProgress);
  await worker.terminate();
}

// PSM 6 ("assume a single uniform block of text"). Tried PSM 11 ("sparse
// text — find as much text as possible in no particular order") first, on
// the theory that a card's scattered, non-paragraph text blocks needed it —
// tested empirically against a real, difficult card (multi-block layout,
// glare, a handwritten annotation) once cropToCardFrame below existed,
// and PSM 11 was consistently the *worst* performer of the modes tried
// (6, 4, 3, 11), often returning pure noise where 6 read real text. Once
// the image is cropped to just the card (below), it's usually closer to
// "one block" than "scattered fragments," which is presumably why.
const PSM_SINGLE_BLOCK = "6";

const CARD_ASPECT = 85.6 / 54;

// Renders exactly the region the user framed in the rotate/scale/position
// editor (a PhotoTransform — see its doc comment in storage.ts) onto a
// plain canvas at a fixed ID-1-ratio resolution, for OCR to read instead of
// the full original photo. Two problems this solves at once:
//
// - The original photo usually includes background around the physical
//   card (table, hands, glare beyond the card's edges) that a full-image
//   OCR pass has no way to know isn't part of "the text to read," and will
//   confidently hallucinate garbage over. Cropped to just the card, that
//   background is simply gone.
// - Tesseract's own image reader (leptonica, inside the wasm core) only
//   understands common raster formats (PNG/JPEG/BMP/...), not HEIC/HEIF —
//   the default capture format on iOS. A photo the browser displays fine
//   via a plain <img> (Safari decodes HEIC natively) can still fail here
//   with "Error attempting to read image." Re-decoding through the
//   browser's own <img>/canvas pipeline (which this does regardless of
//   whether there's a real crop to apply) sidesteps that entirely: canvas
//   only ever exports pixels, in a format Tesseract is always guaranteed to
//   read, whatever the source format was.
//
// This is a throwaway conversion purely for recognition — it never touches
// the stored photo, matching this app's "never re-encode the saved photo"
// rule.
export function cropToCardFrame(imageDataUrl: string, transform: PhotoTransform | undefined, outputWidth = 1800): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const outW = outputWidth;
      const outH = Math.round(outW / CARD_ASPECT);
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not get a canvas context to prepare this image for recognition"));
        return;
      }

      const { rotate, scale, offsetX, offsetY } = transform || { rotate: 0, scale: 1, offsetX: 0, offsetY: 0 };

      // Same "object-fit: contain" placement CSS uses (photoCardHtml in
      // card-view.ts) to fit the source image into the ID-1 box before the
      // user's own rotate/scale/pan adjustment on top of it.
      const s0 = Math.min(outW / img.naturalWidth, outH / img.naturalHeight);
      const drawW = img.naturalWidth * s0;
      const drawH = img.naturalHeight * s0;
      const drawX = (outW - drawW) / 2;
      const drawY = (outH - drawH) / 2;

      // Mirrors the CSS `transform: translate(...) rotate(...) scale(...)`
      // with transform-origin: center that photoTransformStyle applies for
      // display — same composition order, same pivot — so this crop is
      // pixel-for-pixel "what the user framed," not an approximation of it.
      ctx.translate(outW / 2, outH / 2);
      ctx.translate(offsetX * outW, offsetY * outH);
      ctx.rotate((rotate * Math.PI) / 180);
      ctx.scale(scale, scale);
      ctx.translate(-outW / 2, -outH / 2);
      ctx.drawImage(img, drawX, drawY, drawW, drawH);

      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => reject(new Error("Could not decode this image"));
    img.src = imageDataUrl;
  });
}

export async function recognizeCardImage(cardImageDataUrl: string, langs: string[], onProgress?: (p: OcrProgress) => void): Promise<OcrLine[]> {
  const worker = await createTesseractWorker(langs, onProgress);
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM_SINGLE_BLOCK });
    // `{ blocks: true }` is required, not just a nice-to-have — recognize()
    // only computes the output formats it's explicitly asked for, and
    // without this `result.data.blocks` comes back `null` unconditionally
    // (confirmed against real recognition output, not assumed), which this
    // function's line-flattening loop below would otherwise silently read
    // as "zero lines found" regardless of how well OCR actually did.
    const result = await worker.recognize(cardImageDataUrl, {}, { blocks: true });
    const lines: OcrLine[] = [];
    for (const block of result.data.blocks || []) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          const text = line.text.trim();
          if (text) lines.push({ text, bbox: line.bbox });
        }
      }
    }
    return lines;
  } finally {
    await worker.terminate();
  }
}
