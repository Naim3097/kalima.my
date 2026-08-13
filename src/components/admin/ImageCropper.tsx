"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/*
  Crop-before-upload for product photography.

  Deliberately dependency-free. The whole job is: drag a rectangle over an
  <img>, then draw that rectangle to a canvas at the file's real resolution.
  A cropping library would be a bigger surface than the feature.

  Two coordinate systems, and keeping them apart is the only subtlety here:
  the rectangle is tracked in DISPLAY pixels (the on-screen image box, which is
  whatever fits the dialog), and converted to NATURAL pixels once, at the
  moment of the crop. Tracking it in natural pixels instead would mean
  converting on every pointer move, and re-deriving the box on every resize.

  Output is always JPEG. It is the one encoder every browser can write, and
  the upload path only accepts jpeg/png/webp/avif anyway. Transparent PNGs are
  flattened onto white rather than onto black, which is what a canvas gives you
  if you just draw.
*/

/** Long-edge ceiling for the written file. Above this is bytes no PDP shows. */
const MAX_OUTPUT_EDGE = 2400;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // must match the upload action

type Rect = { x: number; y: number; w: number; h: number };
type Handle = "nw" | "ne" | "sw" | "se";
type Drag =
  | { kind: "move"; startX: number; startY: number; rect: Rect }
  | { kind: "resize"; handle: Handle; startX: number; startY: number; rect: Rect };

const ASPECTS: { label: string; value: number | null }[] = [
  // 4:5 is what ProductImage renders the PLP and PDP at, so it is the default.
  { label: "4:5 · storefront", value: 4 / 5 },
  { label: "3:4", value: 3 / 4 },
  { label: "1:1", value: 1 },
  { label: "Free", value: null },
];

/** The largest rect of `aspect` that fits `box`, centred. */
function fitRect(box: { w: number; h: number }, aspect: number | null): Rect {
  if (aspect === null) return { x: 0, y: 0, w: box.w, h: box.h };
  let w = box.w;
  let h = w / aspect;
  if (h > box.h) {
    h = box.h;
    w = h * aspect;
  }
  return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
}

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

export function ImageCropper({
  file,
  title,
  busy,
  onCancel,
  onSkip,
  onCropped,
}: {
  /** The image to crop. A blob URL is minted for it and revoked on unmount. */
  file: File;
  title: string;
  busy?: boolean;
  onCancel: () => void;
  /** Use the original, uncropped. Omitted when there is no original to keep —
   *  re-cropping a live photo, where "keep it as it is" is just Cancel. */
  onSkip?: () => void;
  onCropped: (cropped: File) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [aspect, setAspect] = useState<number | null>(4 / 5);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [working, setWorking] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  /*
    The displayed size is whatever the dialog's max-height leaves, which is not
    known until layout — and changes when the window resizes. Re-measure on
    both, and refit the rectangle to the new box.
  */
  const measure = useCallback(() => {
    const el = imgRef.current;
    if (!el || !el.clientWidth) return;
    const next = { w: el.clientWidth, h: el.clientHeight };
    setBox(next);
    setRect(fitRect(next, aspect));
  }, [aspect]);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  function onPointerDown(e: React.PointerEvent, spec: Drag) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = spec;
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || !box) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;

    if (d.kind === "move") {
      setRect({
        ...d.rect,
        x: clamp(d.rect.x + dx, 0, box.w - d.rect.w),
        y: clamp(d.rect.y + dy, 0, box.h - d.rect.h),
      });
      return;
    }

    /*
      Resize from a corner: the opposite corner is the anchor and never moves.
      With an aspect lock the width leads and the height follows, so the shape
      is preserved no matter which way the pointer travels.
    */
    const r = d.rect;
    const right = r.x + r.w;
    const bottom = r.y + r.h;
    const west = d.handle === "nw" || d.handle === "sw";
    const north = d.handle === "nw" || d.handle === "ne";

    let w = west ? r.w - dx : r.w + dx;
    // Available room from the anchor outwards, so the rect can never leave the image.
    const maxW = west ? right : box.w - r.x;
    const maxH = north ? bottom : box.h - r.y;
    w = clamp(w, 24, maxW);
    let h = aspect === null ? clamp(north ? r.h - dy : r.h + dy, 24, maxH) : w / aspect;
    if (h > maxH) {
      h = maxH;
      if (aspect !== null) w = h * aspect;
    }

    setRect({
      x: west ? right - w : r.x,
      y: north ? bottom - h : r.y,
      w,
      h,
    });
  }

  function endDrag() {
    drag.current = null;
  }

  function pickAspect(value: number | null) {
    setAspect(value);
    if (box) setRect(fitRect(box, value));
  }

  async function confirm() {
    const img = imgRef.current;
    if (!img || !rect || !box) return;
    setWorking(true);
    try {
      // Display pixels → natural pixels. One conversion, right here.
      const scale = img.naturalWidth / box.w;
      const sx = Math.round(rect.x * scale);
      const sy = Math.round(rect.y * scale);
      const sw = Math.max(1, Math.round(rect.w * scale));
      const sh = Math.max(1, Math.round(rect.h * scale));

      const shrink = Math.min(1, MAX_OUTPUT_EDGE / Math.max(sw, sh));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sw * shrink));
      canvas.height = Math.max(1, Math.round(sh * shrink));

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is unavailable in this browser.");
      // Flatten transparency onto white — a JPEG has no alpha to keep.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

      // Step the quality down rather than fail the upload on an oversized file.
      let blob: Blob | null = null;
      for (const quality of [0.92, 0.8, 0.65]) {
        blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", quality),
        );
        if (blob && blob.size <= MAX_OUTPUT_BYTES) break;
      }
      if (!blob) throw new Error("Could not encode the cropped image.");

      const name = `${file.name.replace(/\.[^.]+$/, "")}.jpg`;
      onCropped(new File([blob], name, { type: "image/jpeg" }));
    } catch (e) {
      // Surfaced by the caller's toast; keep the dialog open so nothing is lost.
      console.error("crop failed:", e);
      setWorking(false);
    }
  }

  const disabled = working || busy;

  return (
    <Dialog open onOpenChange={(open) => !open && !disabled && onCancel()}>
      <DialogContent className="max-w-3xl gap-0 border-navy/10 bg-white p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-navy/10 px-5 py-4">
          <DialogTitle className="label-caps !text-[12px] text-navy">{title}</DialogTitle>
          <DialogDescription className="text-[12px] tracking-wide text-navy-400">
            Drag the frame to reposition, or pull a corner to resize. Everything outside
            it is discarded.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 border-b border-navy/10 px-5 py-3">
          <span className="label-caps !text-[10px] text-navy-400">Shape</span>
          {ASPECTS.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => pickAspect(a.value)}
              className={`cursor-pointer border px-2.5 py-1 text-[11px] tracking-wide transition-colors ${
                aspect === a.value
                  ? "border-navy bg-navy text-white"
                  : "border-navy/20 text-navy hover:border-navy"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>

        <div className="flex justify-center bg-navy-100/40 p-5">
          <div className="relative inline-block max-h-[55vh]">
            {url && (
              // eslint-disable-next-line @next/next/no-img-element -- blob source, and the
              // natural dimensions have to be readable off the element itself.
              <img
                ref={imgRef}
                src={url}
                alt=""
                onLoad={measure}
                draggable={false}
                className="block max-h-[55vh] max-w-full select-none"
              />
            )}

            {rect && box && (
              <div
                className="absolute inset-0 touch-none"
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                {/* Dim everything the crop throws away. */}
                <div
                  className="pointer-events-none absolute inset-0 bg-navy/50"
                  style={{
                    clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rect.x}px ${rect.y}px, ${rect.x}px ${rect.y + rect.h}px, ${rect.x + rect.w}px ${rect.y + rect.h}px, ${rect.x + rect.w}px ${rect.y}px, ${rect.x}px ${rect.y}px)`,
                  }}
                />
                <div
                  role="presentation"
                  onPointerDown={(e) =>
                    onPointerDown(e, {
                      kind: "move",
                      startX: e.clientX,
                      startY: e.clientY,
                      rect,
                    })
                  }
                  className="absolute cursor-move border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                  style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
                >
                  {(["nw", "ne", "sw", "se"] as Handle[]).map((h) => (
                    <span
                      key={h}
                      onPointerDown={(e) =>
                        onPointerDown(e, {
                          kind: "resize",
                          handle: h,
                          startX: e.clientX,
                          startY: e.clientY,
                          rect,
                        })
                      }
                      className={`absolute size-4 border border-navy bg-white ${
                        h === "nw"
                          ? "-left-2 -top-2 cursor-nwse-resize"
                          : h === "ne"
                            ? "-right-2 -top-2 cursor-nesw-resize"
                            : h === "sw"
                              ? "-bottom-2 -left-2 cursor-nesw-resize"
                              : "-bottom-2 -right-2 cursor-nwse-resize"
                      }`}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-navy/10 px-5 py-4">
          <Button
            type="button"
            variant="kalimaOutline"
            size="editorial"
            disabled={disabled}
            onClick={onCancel}
          >
            Cancel
          </Button>
          {onSkip && (
            <Button
              type="button"
              variant="kalimaOutline"
              size="editorial"
              disabled={disabled}
              onClick={onSkip}
            >
              Use original
            </Button>
          )}
          <Button
            type="button"
            variant="kalima"
            size="editorial"
            disabled={disabled || !rect}
            onClick={confirm}
          >
            {disabled ? "Working…" : "Crop"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
