import { recognizeCardImage, type OcrProgress } from "./ocr";
import { parseContactFields, type RecognizedField } from "./recognizer-core";

export { parseContactFields };
export type { FieldType, RecognizedField } from "./recognizer-core";

// Business layer boundary: OCR + rule parsing + any future AI enhancement
// are all just implementations of this. Swapping the OCR engine, or adding
// the optional local-model disambiguation pass discussed but deferred for
// this feature, means writing a new ContactRecognizer — nothing above this
// interface (the confirm/edit UI, storage) needs to know which one is in use.
export interface ContactRecognizer {
  recognize(imageDataUrl: string): Promise<RecognizedField[]>;
}

export class TesseractContactRecognizer implements ContactRecognizer {
  private langs: string[];
  private onProgress?: (p: OcrProgress) => void;

  constructor(langs: string[], onProgress?: (p: OcrProgress) => void) {
    this.langs = langs;
    this.onProgress = onProgress;
  }

  async recognize(imageDataUrl: string): Promise<RecognizedField[]> {
    const lines = await recognizeCardImage(imageDataUrl, this.langs, this.onProgress);
    return parseContactFields(lines);
  }
}
