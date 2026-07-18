"use client";

import {
  ChangeEvent,
  FormEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const OUTPUT_WIDTH = 2000;
const OUTPUT_HEIGHT = 2570;
const LEVELS = ["K1", "K2", "P1", "P2", "P3", "P4", "P5", "P6"] as const;
type Level = (typeof LEVELS)[number];
type Step = "camera" | "crop" | "details" | "success";
type ImageSize = { width: number; height: number };
type StillImageCapture = { takePhoto: () => Promise<Blob> };
type StillImageCaptureConstructor = new (
  track: MediaStreamTrack,
) => StillImageCapture;

export default function CameraApp() {
  const [step, setStep] = useState<Step>("camera");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [sourceUrl, setSourceUrl] = useState("");
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [cropSize, setCropSize] = useState<ImageSize | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [name, setName] = useState("");
  const [classGroup, setClassGroup] = useState<"A" | "B">("A");
  const [level, setLevel] = useState<Level>("K1");
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cropRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef({ active: false, x: 0, y: 0 });

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera is not available. Choose an image instead.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 4096 },
          height: { ideal: 3072 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      requestAnimationFrame(() => {
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        void videoRef.current.play();
      });
    } catch {
      setCameraError(
        "Allow camera access, or choose an image from your device.",
      );
    }
  }, [facingMode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void startCamera(), 0);
    return () => {
      window.clearTimeout(timer);
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    };
  }, [sourceUrl]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (step !== "crop" || !cropRef.current) return;
    const crop = cropRef.current;
    const measure = () => {
      const bounds = crop.getBoundingClientRect();
      setCropSize({ width: bounds.width, height: bounds.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(crop);
    return () => observer.disconnect();
  }, [step]);

  function savePhoto(blob: Blob) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPhoto(blob);
    setPreviewUrl(URL.createObjectURL(blob));
    setStep("details");
  }

  async function capturePhoto() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setCameraError("Camera is still starting. Try again in a moment.");
      return;
    }

    setCapturing(true);
    try {
      const track = streamRef.current?.getVideoTracks()[0];
      const ImageCaptureApi = (
        window as typeof window & {
          ImageCapture?: StillImageCaptureConstructor;
        }
      ).ImageCapture;

      if (track && ImageCaptureApi) {
        try {
          const sensorBlob = await new ImageCaptureApi(track).takePhoto();
          const bitmap = await createImageBitmap(sensorBlob);
          const captured = await cropToOutput(
            bitmap,
            bitmap.width,
            bitmap.height,
          );
          bitmap.close();
          if (captured) {
            stopCamera();
            savePhoto(captured);
            return;
          }
        } catch {
          // Some browsers expose ImageCapture but not takePhoto; use video below.
        }
      }

      const captured = await cropToOutput(
        video,
        video.videoWidth,
        video.videoHeight,
      );
      if (captured) {
        stopCamera();
        savePhoto(captured);
      }
    } finally {
      setCapturing(false);
    }
  }

  async function cropToOutput(
    source: CanvasImageSource,
    inputWidth: number,
    inputHeight: number,
  ) {
    const sourceRatio = inputWidth / inputHeight;
    const targetRatio = OUTPUT_WIDTH / OUTPUT_HEIGHT;
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = inputWidth;
    let sourceHeight = inputHeight;

    // Crop the centre of the camera frame automatically to exactly 34:44.
    if (sourceRatio > targetRatio) {
      sourceWidth = inputHeight * targetRatio;
      sourceX = (inputWidth - sourceWidth) / 2;
    } else {
      sourceHeight = inputWidth / targetRatio;
      sourceY = (inputHeight - sourceHeight) / 2;
    }

    const canvas = makeOutputCanvas();
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(
      source,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      OUTPUT_WIDTH,
      OUTPUT_HEIGHT,
    );
    return new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.97),
    );
  }

  function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    stopCamera();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setSourceUrl(URL.createObjectURL(file));
    setImageSize(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setStep("crop");
  }

  function switchCamera() {
    stopCamera();
    setFacingMode((current) => (current === "user" ? "environment" : "user"));
  }

  function getScale(nextZoom = zoom) {
    if (!cropSize || !imageSize) return 1;
    return (
      Math.max(
        cropSize.width / imageSize.width,
        cropSize.height / imageSize.height,
      ) * nextZoom
    );
  }

  function clampOffset(next: { x: number; y: number }, nextZoom = zoom) {
    if (!cropSize || !imageSize) return next;
    const scale = getScale(nextZoom);
    const maxX = Math.max(0, (imageSize.width * scale - cropSize.width) / 2);
    const maxY = Math.max(0, (imageSize.height * scale - cropSize.height) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { active: true, x: event.clientX, y: event.clientY };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current.active) return;
    const next = {
      x: offset.x + event.clientX - dragRef.current.x,
      y: offset.y + event.clientY - dragRef.current.y,
    };
    dragRef.current = { active: true, x: event.clientX, y: event.clientY };
    setOffset(clampOffset(next));
  }

  async function confirmCrop() {
    const crop = cropRef.current;
    const image = imageRef.current;
    if (!crop || !image || !imageSize) return;
    const bounds = crop.getBoundingClientRect();
    const scale = getScale();
    const shownWidth = imageSize.width * scale;
    const shownHeight = imageSize.height * scale;
    const left = bounds.width / 2 + offset.x - shownWidth / 2;
    const top = bounds.height / 2 + offset.y - shownHeight / 2;
    const sourceX = Math.max(0, -left / scale);
    const sourceY = Math.max(0, -top / scale);
    const sourceWidth = Math.min(
      imageSize.width - sourceX,
      bounds.width / scale,
    );
    const sourceHeight = Math.min(
      imageSize.height - sourceY,
      bounds.height / scale,
    );

    const canvas = makeOutputCanvas();
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      OUTPUT_WIDTH,
      OUTPUT_HEIGHT,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.97),
    );
    if (blob) savePhoto(blob);
  }

  function reset() {
    stopCamera();
    setPhoto(null);
    setSubmitError("");
    setStep("camera");
    void startCamera();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!photo || !name.trim()) return;
    setUploading(true);
    setSubmitError("");
    try {
      const body = new FormData();
      body.append("photo", photo, "passport-photo.jpg");
      body.append("name", name.trim());
      body.append("classGroup", classGroup);
      body.append("level", level);
      const response = await fetch("/api/photos", { method: "POST", body });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Upload failed.");
      setStep("success");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  const scale = getScale();
  const imageStyle =
    imageSize && cropSize
      ? {
          width: imageSize.width * scale,
          height: imageSize.height * scale,
          left: `calc(50% + ${offset.x}px)`,
          top: `calc(50% + ${offset.y}px)`,
        }
      : undefined;

  if (step === "camera") {
    return (
      <main className="camera-page">
        <h1 className="text-white text-xl">BWM Passport</h1>
        <div className="camera-view">
          {cameraOpen ? (
            <video
              ref={videoRef}
              playsInline
              muted
              aria-label="Camera preview"
            />
          ) : (
            <div className="camera-empty">
              <p>{cameraError || "Starting camera…"}</p>
              <button type="button" onClick={startCamera}>
                Start camera
              </button>
            </div>
          )}
          <span className="ratio-label">2000 × 2570 px</span>
        </div>
        <div className="camera-controls">
          <button
            className="gallery-button mx-auto"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Choose an image from your device"
            title="Choose image"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <circle cx="8.5" cy="9" r="1.5" />
              <path d="m4 17 4.5-4.5 3.5 3.5 2-2 6 5" />
            </svg>
          </button>
          <button
            className="capture-button"
            type="button"
            onClick={capturePhoto}
            disabled={!cameraOpen || capturing}
            aria-label="Take photo"
          >
            <span />
          </button>
          <button
            className="switch-button mx-auto"
            type="button"
            onClick={switchCamera}
            disabled={!cameraOpen}
            aria-label="Switch between front and rear cameras"
            title="Switch camera"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M20 7h-3l-1.5-2h-7L7 7H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z" />
              <path d="M15.5 11a4 4 0 0 0-6.8-1.4L7.5 11" />
              <path d="m7.5 8.5 0 2.5H10" />
              <path d="M8.5 15a4 4 0 0 0 6.8 1.4l1.2-1.4" />
              <path d="m16.5 17.5 0-2.5H14" />
            </svg>
          </button>
        </div>
        <input
          ref={fileInputRef}
          className="hidden-input"
          type="file"
          accept="image/*"
          onChange={chooseImage}
        />
      </main>
    );
  }

  if (step === "crop") {
    return (
      <main className="simple-page">
        <h1 className="text-white text-xl">BWM Passport</h1>
        <div
          className="crop-view"
          ref={cropRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => {
            dragRef.current.active = false;
          }}
          onPointerCancel={() => {
            dragRef.current.active = false;
          }}
        >
          {/* Local image selected by the user. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={sourceUrl}
            alt="Image to crop"
            draggable={false}
            style={imageStyle}
            onLoad={(event) =>
              setImageSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
          />
          <span>2000 × 2570 px</span>
        </div>
        <label className="zoom">
          Zoom
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(event) => {
              const nextZoom = Number(event.target.value);
              setZoom(nextZoom);
              setOffset((current) => clampOffset(current, nextZoom));
            }}
          />
        </label>
        <div className="row-actions">
          <button type="button" onClick={reset}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={confirmCrop}
            disabled={!imageSize}
          >
            Use image
          </button>
        </div>
      </main>
    );
  }

  if (step === "details") {
    return (
      <main className="simple-page details-page">
        <h1 className="text-white text-xl">BWM Passport</h1>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="photo-result"
          src={previewUrl}
          alt="Student photo preview"
        />
        <form onSubmit={submit}>
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
              autoFocus
            />
          </label>
          <label>
            Class
            <select
              value={classGroup}
              onChange={(event) =>
                setClassGroup(event.target.value as "A" | "B")
              }
            >
              <option value="A">A</option>
              <option value="B">B</option>
            </select>
          </label>
          <label>
            Level
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value as Level)}
            >
              {LEVELS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          {submitError && (
            <p className="form-error" role="alert">
              {submitError}
            </p>
          )}
          <div className="row-actions">
            <button type="button" onClick={reset}>
              Retake
            </button>
            <button type="submit" className="primary" disabled={uploading}>
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </div>
        </form>
      </main>
    );
  }

  return (
    <main className="simple-page success-page">
      <h1 className="text-white text-xl">BWM Passport</h1>
      <p>Photo uploaded.</p>
      <button
        type="button"
        className="primary"
        onClick={() => {
          setName("");
          setClassGroup("A");
          setLevel("K1");
          reset();
        }}
      >
        Take another
      </button>
    </main>
  );
}

function makeOutputCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  const context = canvas.getContext("2d");
  if (context) {
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
  }
  return canvas;
}
