"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { createCmsImageUploadUrl } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { framingStyle } from "@/lib/images";
import { createClient } from "@/lib/supabase/client";

/*
  CMS photography: upload, then frame. Shared by the hero slides and the
  homepage's editorial slots.

  Framing is NON-DESTRUCTIVE and lives on the row. These frames are full-bleed
  or fixed-aspect and change shape between breakpoints — the hero is tall on
  mobile and wide on desktop — so object-cover re-crops whatever it is handed.
  Baking a crop into the file would settle nothing and throw the surrounding
  pixels away for good. Instead the full upload is kept and two values decide
  what shows: `focal` (where the photo sits) and `zoom` (how far it is scaled
  around that point, which crops IN).

  The preview frames through framingStyle(), the SAME helper the storefront
  renders with, so what is dragged here is what ships. Any divergence makes this
  a decoration rather than an editor — which is why the shapes below are the
  real ones from the components, and why they have to be corrected if a section
  is ever re-laid-out.

  Upload goes browser → Storage through a short-lived signed URL from a
  staff-gated action, mirroring ProductImages: the bytes never cross a server
  action and the browser never holds write credentials.
*/

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif";
const BUCKET = "product-images";
const MAX_BYTES = 5 * 1024 * 1024; // must match createCmsImageUploadUrl

export type Frame = { key: string; label: string; className: string };

/*
  The shapes each surface actually renders at. Approximate where the frame is a
  fraction of the viewport rather than a fixed ratio — the hero's desktop panel
  widens on a bigger screen — but close enough to judge a crop by.
*/
export const HERO_FRAMES: Frame[] = [
  { key: "desktop", label: "Desktop", className: "aspect-[7/5]" },
  { key: "mobile", label: "Mobile", className: "aspect-[9/10] max-w-[280px]" },
];

/** Category tiles: a fixed 4:3 card. */
export const TILE_FRAMES: Frame[] = [{ key: "tile", label: "Tile", className: "aspect-[4/3]" }];

/** The spotlight's arch — masked, so the mask is part of the framing decision. */
export const SPOTLIGHT_FRAMES: Frame[] = [
  { key: "arch", label: "Arch", className: "aspect-[4/5] max-w-[260px] rounded-t-[999px]" },
];

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

/*
  `focal` is a CSS object-position, and it has been free text since the column
  existed — "center 25%", "center", "62% 28%". Parse the forms that can be
  shown on a two-axis pad and fall back to the middle for anything else, so an
  exotic value renders honestly rather than silently pretending to be centred.
*/
const KEYWORDS_X: Record<string, number> = { left: 0, center: 50, centre: 50, right: 100 };
const KEYWORDS_Y: Record<string, number> = { top: 0, center: 50, centre: 50, bottom: 100 };

export function parseFocal(focal: string | null | undefined): { x: number; y: number } {
  const parts = (focal ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { x: 50, y: 50 };

  const axis = (token: string, keywords: Record<string, number>): number | null => {
    if (token in keywords) return keywords[token];
    const pct = /^(-?\d+(?:\.\d+)?)%$/.exec(token);
    return pct ? clamp(Number(pct[1]), 0, 100) : null;
  };

  // A single token sets the horizontal axis and centres the vertical.
  const x = axis(parts[0], KEYWORDS_X);
  const y = parts.length > 1 ? axis(parts[1], KEYWORDS_Y) : 50;
  if (x === null || y === null) return { x: 50, y: 50 };
  return { x, y };
}

const formatFocal = (x: number, y: number) => `${Math.round(x)}% ${Math.round(y)}%`;

export function CmsImageField({
  image,
  focal,
  zoom,
  disabled,
  /** Storage prefix for uploads — one of the folders the action allows. */
  folder,
  /** The shapes this image renders at; the first is shown initially. */
  frames = HERO_FRAMES,
  onImageChange,
  onFocalChange,
  onZoomChange,
}: {
  image: string;
  focal: string;
  zoom: number;
  disabled?: boolean;
  folder: "hero" | "editorial";
  frames?: Frame[];
  onImageChange: (url: string) => void;
  onFocalChange: (focal: string) => void;
  onZoomChange: (zoom: number) => void;
}) {
  const [frame, setFrame] = useState<string>(frames[0].key);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const padRef = useRef<HTMLDivElement>(null);

  const point = parseFocal(focal);
  const busy = disabled || uploading;

  /* Pointer position → percentage of the frame, which IS the focal point:
     the spot under the cursor is the spot held in view. */
  function setFocalFromPointer(clientX: number, clientY: number) {
    const el = padRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) return;
    onFocalChange(
      formatFocal(
        clamp(((clientX - box.left) / box.width) * 100, 0, 100),
        clamp(((clientY - box.top) / box.height) * 100, 0, 100),
      ),
    );
  }

  async function upload(file: File) {
    if (file.size > MAX_BYTES) {
      toast.error("Images must be 5 MB or smaller.");
      return;
    }
    const supabase = createClient();
    if (!supabase) {
      toast.error("Storage is not configured.");
      return;
    }

    setUploading(true);
    try {
      const signed = await createCmsImageUploadUrl(folder, file.type, file.size);
      if ("error" in signed) {
        toast.error(signed.error);
        return;
      }
      const { error } = await supabase.storage
        .from(BUCKET)
        .uploadToSignedUrl(signed.path, signed.token, file);
      if (error) {
        toast.error(error.message);
        return;
      }
      /*
        The row still points at the old image until Save — the upload is not the
        edit. Framing is reset because it described a different photograph, and
        carrying it over lands the new one somewhere arbitrary.
      */
      onImageChange(signed.publicUrl);
      onFocalChange("50% 50%");
      onZoomChange(1);
      toast.success("Image uploaded. Frame it, then save.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const active = frames.find((f) => f.key === frame) ?? frames[0];

  return (
    <div className="space-y-3 border border-navy/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="label-caps text-navy-400">Image</Label>
        <div className="flex items-center gap-1">
          {frames.length > 1 && frames.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFrame(f.key)}
              className={`cursor-pointer border px-2.5 py-1 text-[11px] tracking-wide transition-colors ${
                frame === f.key
                  ? "border-navy bg-navy text-white"
                  : "border-navy/20 text-navy hover:border-navy"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Framing pad — the storefront's own render, at editing size. */}
      {image ? (
        <div className="flex justify-center bg-navy-100/40 p-3">
          <div
            ref={padRef}
            role="presentation"
            onPointerDown={(e) => {
              if (busy) return;
              e.preventDefault();
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              setDragging(true);
              setFocalFromPointer(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => {
              if (!dragging) return;
              setFocalFromPointer(e.clientX, e.clientY);
            }}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
            className={`relative w-full touch-none overflow-hidden ${
              busy ? "cursor-wait" : "cursor-crosshair"
            } ${active.className}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- the URL is
                whatever the slide holds (Storage, /public, or a foreign host on
                staging's copied rows); next/image would reject the last of those,
                and this is a fixed-size editing preview, not a shipped image. */}
            <img
              src={image}
              alt=""
              draggable={false}
              className="absolute inset-0 size-full select-none object-cover"
              style={framingStyle({ focal: focal || "50% 50%", zoom })}
            />

            {/* Crosshair: where the frame is being held. */}
            <span
              aria-hidden
              className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
            />
          </div>
        </div>
      ) : (
        <p className="bg-navy-100/40 px-4 py-10 text-center text-[13px] text-navy-400">
          No image yet. Upload one, or paste a path below.
        </p>
      )}

      <p className="text-[12px] tracking-wide text-navy-400">
        {image
          ? "Click or drag on the photo to choose the point that stays in view. Zoom crops in around it — nothing is cut from the file."
          : "JPEG, PNG, WebP or AVIF, up to 5 MB."}
      </p>

      {/* Zoom */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="hero-zoom" className="label-caps text-navy-400">
            Zoom
          </Label>
          <span className="text-[12px] tabular-nums text-navy-400">{zoom.toFixed(2)}×</span>
        </div>
        <input
          id="hero-zoom"
          type="range"
          min={1}
          max={3}
          step={0.05}
          value={zoom}
          disabled={busy || !image}
          onChange={(e) => onZoomChange(Number(e.target.value))}
          className="w-full cursor-pointer accent-navy disabled:cursor-not-allowed"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <Button
          type="button"
          variant="kalimaOutline"
          size="sm"
          className="cursor-pointer"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? "Uploading…" : image ? "Replace image" : "Upload image"}
        </Button>
        <Button
          type="button"
          variant="kalimaOutline"
          size="sm"
          className="cursor-pointer"
          disabled={busy || !image || (point.x === 50 && point.y === 50 && zoom === 1)}
          onClick={() => {
            onFocalChange("50% 50%");
            onZoomChange(1);
          }}
        >
          Reset framing
        </Button>
      </div>

      {/*
        The path stays editable. Seed slides point at /public artwork and
        staging's copied rows point at production's bucket — neither came from
        an upload, and both must remain fixable without one.
      */}
      <div className="space-y-2">
        <Label htmlFor="hero-image" className="label-caps text-navy-400">
          Image path
        </Label>
        <Input
          id="hero-image"
          value={image}
          disabled={busy}
          onChange={(e) => onImageChange(e.target.value)}
          placeholder="/products/ruwa-caftan.jpg"
        />
      </div>
    </div>
  );
}
