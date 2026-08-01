"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ImageIcon, SwitchCamera } from "lucide-react";
import {
  ChangeEvent,
  FormEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  preloadBackgroundRemoval,
  removePhotoBackground,
} from "../lib/remove-background";
import { makePhotoFilename } from "../lib/photo-filename";

const OUTPUT_WIDTH = 2000;
const OUTPUT_HEIGHT = 2570;
const LEVELS = ["K1", "K2", "P1", "P2", "P3", "P4", "P5", "P6"] as const;
const CLASS_DISTRICTS = [
  "A",
  "B",
  "Tampines",
  "Jurong",
  "Aljunied AM (10AM-12PM)",
  "Aljunied PM (3PM-5PM)",
] as const;
const CLASS_STORAGE_KEY = "bwm-passport:class";
const LEVEL_STORAGE_KEY = "bwm-passport:level";
type Level = (typeof LEVELS)[number];
type ClassDistrict = (typeof CLASS_DISTRICTS)[number];
type Step = "camera" | "crop" | "processing" | "details" | "success";
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
  const [pendingPhoto, setPendingPhoto] = useState<Blob | null>(null);
  const [processingError, setProcessingError] = useState("");
  const [processingPreviewUrl, setProcessingPreviewUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [name, setName] = useState("");
  const [classGroup, setClassGroup] = useState<ClassDistrict>("A");
  const [level, setLevel] = useState<Level>("K1");
  const [isTeacher, setIsTeacher] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cropRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef({ active: false, x: 0, y: 0 });
  const processingIdRef = useRef(0);
  const preferencesLoadedRef = useRef(false);

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
    void preloadBackgroundRemoval().catch(() => {
      // The processing screen will show a retry option if preloading failed.
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const savedClass = window.localStorage.getItem(CLASS_STORAGE_KEY);
        const savedLevel = window.localStorage.getItem(LEVEL_STORAGE_KEY);

        if (CLASS_DISTRICTS.includes(savedClass as ClassDistrict)) {
          setClassGroup(savedClass as ClassDistrict);
        }
        if (LEVELS.includes(savedLevel as Level)) {
          setLevel(savedLevel as Level);
        }
      } catch {
        // Continue with the defaults when browser storage is unavailable.
      } finally {
        preferencesLoadedRef.current = true;
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!preferencesLoadedRef.current) return;

    try {
      window.localStorage.setItem(CLASS_STORAGE_KEY, classGroup);
      window.localStorage.setItem(LEVEL_STORAGE_KEY, level);
    } catch {
      // The current selections still work when browser storage is unavailable.
    }
  }, [classGroup, level]);

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
    return () => {
      if (processingPreviewUrl) URL.revokeObjectURL(processingPreviewUrl);
    };
  }, [processingPreviewUrl]);

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

  async function savePhoto(blob: Blob) {
    const processingId = ++processingIdRef.current;
    if (processingPreviewUrl) URL.revokeObjectURL(processingPreviewUrl);
    const processingUrl = URL.createObjectURL(blob);
    setProcessingPreviewUrl(processingUrl);
    setPendingPhoto(blob);
    setProcessingError("");
    setStep("processing");
    try {
      const cleanedPhoto = await removePhotoBackground(blob);
      if (processingId !== processingIdRef.current) return;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPhoto(cleanedPhoto);
      setPreviewUrl(URL.createObjectURL(cleanedPhoto));
      URL.revokeObjectURL(processingUrl);
      setProcessingPreviewUrl((current) =>
        current === processingUrl ? "" : current,
      );
      setStep("details");
    } catch (error) {
      if (processingId !== processingIdRef.current) return;
      setProcessingError(
        error instanceof Error
          ? error.message
          : "The background could not be removed.",
      );
    }
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
      const mirrorPhoto =
        (track?.getSettings().facingMode ?? facingMode) === "user";
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
            mirrorPhoto,
          );
          bitmap.close();
          if (captured) {
            stopCamera();
            void savePhoto(captured);
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
        mirrorPhoto,
      );
      if (captured) {
        stopCamera();
        void savePhoto(captured);
      }
    } finally {
      setCapturing(false);
    }
  }

  async function cropToOutput(
    source: CanvasImageSource,
    inputWidth: number,
    inputHeight: number,
    mirrorHorizontal = false,
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
    context.save();
    if (mirrorHorizontal) {
      context.translate(OUTPUT_WIDTH, 0);
      context.scale(-1, 1);
    }
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
    context.restore();
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
    if (blob) void savePhoto(blob);
  }

  function reset() {
    processingIdRef.current += 1;
    stopCamera();
    setPhoto(null);
    setPendingPhoto(null);
    setProcessingError("");
    if (processingPreviewUrl) URL.revokeObjectURL(processingPreviewUrl);
    setProcessingPreviewUrl("");
    setSubmitError("");
    setStep("camera");
    void startCamera();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!photo || !name.trim()) return;
    const studentName = name.trim();
    const filename = makePhotoFilename(studentName, level, classGroup);
    savePhotoToDevice(photo, filename);
    setUploading(true);
    setSubmitError("");
    try {
      const body = new FormData();
      body.append("photo", photo, filename);
      body.append("name", studentName);
      body.append("classGroup", classGroup);
      body.append("level", level);
      body.append("isTeacher", String(isTeacher));
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
      <main className="camera-page flex min-h-svh flex-col items-center justify-center gap-[22px] bg-[#0a0a0a] p-5">
        <h1 className="text-white text-xl">BWM Passport</h1>
        <div className="camera-view">
          {cameraOpen ? (
            <video
              ref={videoRef}
              playsInline
              muted
              aria-label="Camera preview"
              className={facingMode === "user" ? "-scale-x-100" : undefined}
            />
          ) : (
            <div className="camera-empty">
              <p>{cameraError || "Starting camera…"}</p>
              <Button type="button" variant="link" onClick={startCamera}>
                Start camera
              </Button>
            </div>
          )}
          <PoseGuide />
          <span className="ratio-label">2000 × 2570 px</span>
        </div>
        <div className="grid w-full max-w-[510px] grid-cols-[1fr_80px_1fr] items-center">
          <Button
            className="gallery-button mx-auto"
            variant="outline"
            size="icon"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Choose an image from your device"
            title="Choose image"
          >
            <ImageIcon aria-hidden="true" />
          </Button>
          <Button
            className="capture-button"
            variant="outline"
            size="icon"
            type="button"
            onClick={capturePhoto}
            disabled={!cameraOpen || capturing}
            aria-label="Take photo"
          >
            <span />
          </Button>
          <Button
            className="switch-button mx-auto"
            variant="outline"
            size="icon"
            type="button"
            onClick={switchCamera}
            disabled={!cameraOpen}
            aria-label="Switch between front and rear cameras"
            title="Switch camera"
          >
            <SwitchCamera aria-hidden="true" />
          </Button>
        </div>
        <Input
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
      <main className="simple-page flex min-h-svh flex-col items-center justify-center gap-[18px] bg-[#0a0a0a] px-5 py-7 text-[#f4f4f4]">
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
          <PoseGuide />
          <span>2000 × 2570 px</span>
        </div>
        <div className="zoom">
          <Label htmlFor="zoom-slider">Zoom</Label>
          <Slider
            id="zoom-slider"
            min={1}
            max={3}
            step={0.01}
            value={[zoom]}
            onValueChange={(values) => {
              const nextZoom = values[0] ?? 1;
              setZoom(nextZoom);
              setOffset((current) => clampOffset(current, nextZoom));
            }}
          />
        </div>
        <div className="row-actions flex w-full max-w-[430px] gap-2.5">
          <Button type="button" variant="outline" onClick={reset}>
            Cancel
          </Button>
          <Button
            type="button"
            className="primary"
            onClick={confirmCrop}
            disabled={!imageSize}
          >
            Use image
          </Button>
        </div>
      </main>
    );
  }

  if (step === "processing") {
    return (
      <main className="simple-page processing-page flex min-h-svh flex-col items-center justify-center gap-[18px] bg-[#0a0a0a] px-5 py-7 text-[#f4f4f4]">
        <h1 className="text-white text-xl">BWM Passport</h1>
        {processingPreviewUrl && (
          <div className="relative aspect-[2000/2570] w-[min(70vw,300px)] overflow-hidden rounded-lg bg-[#1b1b1b]">
            {/* Local object URL needs the browser's native image decoder. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="h-full w-full scale-105 object-cover opacity-60 blur-xs"
              src={processingPreviewUrl}
              alt="Photo being processed"
            />
            {!processingError && (
              <div className="absolute inset-0 grid place-content-center justify-items-center gap-3 bg-black/20 px-4 text-center">
                <span className="processing-spinner" aria-hidden="true" />
                <p className="font-medium">Processing image…</p>
              </div>
            )}
          </div>
        )}
        {processingError ? (
          <>
            <p className="form-error" role="alert">
              {processingError}
            </p>
            <div className="row-actions flex w-full max-w-[430px] gap-2.5">
              <Button type="button" variant="outline" onClick={reset}>
                Retake
              </Button>
              <Button
                type="button"
                className="primary"
                onClick={() => pendingPhoto && void savePhoto(pendingPhoto)}
                disabled={!pendingPhoto}
              >
                Try again
              </Button>
            </div>
          </>
        ) : (
          <small>This may take a moment the first time.</small>
        )}
      </main>
    );
  }

  if (step === "details") {
    return (
      <main className="simple-page details-page flex min-h-svh flex-col items-center justify-start gap-[18px] overflow-auto bg-[#0a0a0a] px-5 py-7 text-[#f4f4f4]">
        <h1 className="text-white text-xl">BWM Passport</h1>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="block aspect-[2000/2570] w-[min(46vw,230px)] bg-[#1b1b1b] object-cover"
          src={previewUrl}
          alt="Photo preview"
        />
        <form
          className="grid w-full max-w-[430px] gap-[15px]"
          onSubmit={submit}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="person-name">Name</Label>
            <Input
              id="person-name"
              className="h-11 rounded-md bg-[#151515] px-3 text-base"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="class-group">Class / District</Label>
            <Select
              value={classGroup}
              onValueChange={(value) => setClassGroup(value as ClassDistrict)}
            >
              <SelectTrigger
                id="class-group"
                className="h-11 w-full rounded-md bg-[#151515] px-3 text-base"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {CLASS_DISTRICTS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="level">Level</Label>
            <Select
              value={level}
              onValueChange={(value) => setLevel(value as Level)}
            >
              <SelectTrigger
                id="level"
                className="h-11 w-full rounded-md bg-[#151515] px-3 text-base"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {LEVELS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-[#3a3a3a] bg-[#151515] px-3 py-2">
            <Label htmlFor="teacher-status" className="cursor-pointer text-xs">
              Cadres / Teachers
            </Label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#a1a1aa]">
                {isTeacher ? "Yes" : "No"}
              </span>
              <Switch
                id="teacher-status"
                checked={isTeacher}
                onCheckedChange={setIsTeacher}
                aria-label="Upload to the Cadres and Teachers folder"
              />
            </div>
          </div>
          {submitError && (
            <p className="form-error" role="alert">
              {submitError}
            </p>
          )}
          <div className="row-actions flex w-full max-w-[430px] gap-2.5">
            <Button type="button" variant="outline" onClick={reset}>
              Retake
            </Button>
            <Button type="submit" className="primary" disabled={uploading}>
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </div>
        </form>
      </main>
    );
  }

  return (
    <main className="simple-page success-page flex min-h-svh flex-col items-center justify-center gap-[18px] bg-[#0a0a0a] px-5 py-7 text-[#f4f4f4]">
      <h1 className="text-white text-xl">BWM Passport</h1>
      <p>Photo uploaded.</p>
      <Button
        type="button"
        className="primary"
        onClick={() => {
          setName("");
          setIsTeacher(false);
          reset();
        }}
      >
        Take another
      </Button>
    </main>
  );
}

function PoseGuide() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10 h-full w-full stroke-white/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.35]"
      viewBox="0 0 200 257"
      fill="none"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <ellipse cx="100" cy="110" rx="70" ry="88" />
      <path d="M79 194v7c-7 11-20 17-38 23C20 231 7 242 2 257" />
      <path d="M121 194v7c7 11 20 17 38 23 21 7 34 18 39 33" />
    </svg>
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

function savePhotoToDevice(photo: Blob, filename: string) {
  const url = URL.createObjectURL(photo);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
