import type { Config } from "@imgly/background-removal";

const OUTPUT_WIDTH = 2000;
const OUTPUT_HEIGHT = 2570;

const BACKGROUND_REMOVAL_CONFIG = {
  device: "cpu",
  model: "isnet_fp16",
  output: {
    format: "image/png",
    quality: 1,
  },
} satisfies Config;

let preloadPromise: Promise<void> | null = null;

export function preloadBackgroundRemoval() {
  if (!preloadPromise) {
    preloadPromise = import("@imgly/background-removal").then(({ preload }) =>
      preload(BACKGROUND_REMOVAL_CONFIG),
    ).catch((error: unknown) => {
      preloadPromise = null;
      throw error;
    });
  }
  return preloadPromise;
}

export async function removePhotoBackground(photo: Blob) {
  await preloadBackgroundRemoval();
  const { removeBackground } = await import("@imgly/background-removal");

  // IMG.LY returns a transparent PNG. The model and source photo stay in the
  // browser; the result is composited onto passport white below.
  const foreground = await removeBackground(
    photo,
    BACKGROUND_REMOVAL_CONFIG,
  );

  const bitmap = await createImageBitmap(foreground);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photo could not be processed.");

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    context.drawImage(bitmap, 0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Photo could not be encoded.")),
        "image/jpeg",
        0.97,
      );
    });
  } finally {
    bitmap.close();
  }
}
