import type { Config } from "@imgly/background-removal";

const OUTPUT_WIDTH = 2000;
const OUTPUT_HEIGHT = 2570;
const ANALYSIS_WIDTH = 1000;
const ANALYSIS_HEIGHT = 1285;
const OUTPUT_JPEG_QUALITY = 0.97;

const DESKTOP_CONFIG = {
  device: "gpu",
  model: "isnet_fp16",
  rescale: true,
  output: { format: "image/png", quality: 1 },
} satisfies Config;

const DESKTOP_CPU_CONFIG = {
  ...DESKTOP_CONFIG,
  device: "cpu",
} satisfies Config;

const MOBILE_CONFIG = {
  // iOS Safari does not support ONNX Runtime's WebGPU execution provider.
  // Use WebAssembly directly instead of waiting for a GPU attempt to fail.
  device: "cpu",
  model: "isnet_quint8",
  rescale: true,
  output: { format: "image/png", quality: 1 },
} satisfies Config;

const preloadPromises = new Map<string, Promise<void>>();

function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  return (
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && window.innerWidth < 1024)
  );
}

function preloadConfig(config: Config) {
  const key = `${config.device ?? "cpu"}:${config.model ?? "default"}`;
  const existing = preloadPromises.get(key);
  if (existing) return existing;

  const promise = import("@imgly/background-removal")
    .then(({ preload }) => preload(config))
    .catch((error: unknown) => {
      preloadPromises.delete(key);
      throw error;
    });
  preloadPromises.set(key, promise);
  return promise;
}

export async function preloadBackgroundRemoval() {
  const configs = isMobileDevice()
    ? [MOBILE_CONFIG]
    : [DESKTOP_CONFIG, DESKTOP_CPU_CONFIG, MOBILE_CONFIG];
  let lastError: unknown;

  for (const config of configs) {
    try {
      await preloadConfig(config);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("The background-removal model could not load.");
}

export async function removePhotoBackground(photo: Blob) {
  const analysisPhoto = await createAnalysisPhoto(photo);
  const configs = isMobileDevice()
    ? [MOBILE_CONFIG]
    : [DESKTOP_CONFIG, DESKTOP_CPU_CONFIG, MOBILE_CONFIG];
  let lastError: unknown;

  for (const config of configs) {
    try {
      const foreground = await removeWithConfig(analysisPhoto, config);
      return compositeOriginalWithMask(photo, foreground);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("The photo background could not be removed.");
}

async function removeWithConfig(photo: Blob, config: Config) {
  await preloadConfig(config);
  const { removeBackground } = await import("@imgly/background-removal");
  return removeBackground(photo, config);
}

async function createAnalysisPhoto(photo: Blob) {
  const bitmap = await createImageBitmap(photo);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = ANALYSIS_WIDTH;
    canvas.height = ANALYSIS_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photo could not be prepared.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
    return await canvasToBlob(canvas, "image/jpeg", 0.9);
  } finally {
    bitmap.close();
  }
}

async function compositeOriginalWithMask(photo: Blob, foreground: Blob) {
  const [original, mask] = await Promise.all([
    createImageBitmap(photo),
    createImageBitmap(foreground),
  ]);

  try {
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photo could not be processed.");

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(original, 0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);

    // Use IMG.LY's transparent result as an alpha mask, while preserving every
    // original full-resolution foreground pixel.
    context.globalCompositeOperation = "destination-in";
    context.drawImage(mask, 0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);

    return canvasToBlob(canvas, "image/jpeg", OUTPUT_JPEG_QUALITY);
  } finally {
    original.close();
    mask.close();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Photo could not be encoded.")),
      type,
      quality,
    );
  });
}
