/**
 * On-device OCR with Tesseract (compiled to WebAssembly).
 *
 * The photo never leaves the device: it is drawn to a canvas here and read
 * by a Web Worker in this tab. Only the OCR engine and its English language
 * data are downloaded (from the jsDelivr CDN, about 10 MB the first time,
 * then cached by the browser).
 */

/**
 * Thermal printouts are faint and low-contrast. Upscaling, greyscale and a
 * contrast stretch make a large difference to Tesseract's accuracy.
 */
async function prepare(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  // Aim for text that is ~30 px tall: scale small photos up, huge ones down.
  const scale = Math.min(2.5, Math.max(1, 2400 / bitmap.width));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Canvas saknas');
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  // Greyscale, and find the darkest and lightest tones (ignoring outliers).
  const histogram = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const grey = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    px[i] = grey;
    histogram[grey]++;
  }
  const total = px.length / 4;
  let low = 0;
  let high = 255;
  for (let acc = 0; low < 255 && acc + histogram[low] < total * 0.02; low++) {
    acc += histogram[low];
  }
  for (let acc = 0; high > 0 && acc + histogram[high] < total * 0.02; high--) {
    acc += histogram[high];
  }
  const range = Math.max(1, high - low);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((px[i] - low) * 255) / range));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export async function readPrintout(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  // Loaded on demand: the OCR engine is only fetched on this page, when used.
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: m => {
      if (m.status === 'recognizing text') {
        onProgress?.(m.progress);
      }
    },
  });
  try {
    const canvas = await prepare(file);
    // Printouts are one column of "label value unit" lines.
    await worker.setParameters({ tessedit_pageseg_mode: '6' as never, preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(canvas);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
