"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  attachProductImage,
  createImageUploadUrl,
  deleteProductImage,
  reorderProductImages,
  replaceProductImage,
  updateProductImage,
} from "@/app/admin/actions";
import { ImageCropper } from "@/components/admin/ImageCropper";
import { Card, CardHeader, Chip } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { EditImage } from "@/lib/admin";

const BUCKET = "product-images";
const ACCEPT = "image/jpeg,image/png,image/webp,image/avif";
const NO_COLOR = "__none__"; // Select can't hold an empty string as a value

/*
  Product photography manager.

  Upload goes browser → Storage directly via a short-lived signed URL minted by
  a staff-gated server action, so image bytes never pass through a server
  action (no body-size ceiling) and the browser never holds write credentials.

  Order is drag-to-sort and it matters: the storefront treats the lowest-position
  image with no colour scope as the hero shot. Giving an image a colour makes it
  that colourway's swatch-click photo instead.

  Every picked file goes through the cropper before it is uploaded, one at a
  time, because a phone photo is rarely framed for a 4:5 product tile. An
  already-published image can be re-cropped too: that uploads a new object and
  repoints the existing row, so the shot keeps its place in the order.
*/
export function ProductImages({
  productId,
  productSlug,
  images,
  colors,
}: {
  productId: string;
  productSlug: string;
  images: EditImage[];
  colors: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  // Local mirror so a drag reorder paints instantly, before the round-trip.
  const [order, setOrder] = useState<EditImage[]>(images);
  const dragIndex = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /*
    The crop queue. `waiting` is what the staffer picked and has not decided on
    yet; `settled` is what they have. Uploading only once the queue empties
    keeps the decisions and the network work apart, so a slow bucket never
    stalls the next crop.
  */
  const [waiting, setWaiting] = useState<File[]>([]);
  const [settled, setSettled] = useState<File[]>([]);
  // An existing image being re-cropped, if any — a separate, single-shot path.
  const [recrop, setRecrop] = useState<{ image: EditImage; file: File } | null>(null);
  const [preparing, setPreparing] = useState(false);

  // Server data wins whenever it changes (upload, delete, external edit).
  const [seen, setSeen] = useState(images);
  if (seen !== images) {
    setSeen(images);
    setOrder(images);
  }

  const hero = order.find((i) => !i.colorName);

  /* Browser → Storage in one PUT. Returns the object key, or null on failure
     (already reported). Shared by the upload queue and the re-crop path. */
  async function uploadOne(file: File): Promise<string | null> {
    const supabase = createClient();
    if (!supabase) {
      toast.error("Storage is not configured.");
      return null;
    }
    const signed = await createImageUploadUrl(productId, file.type, file.size);
    if ("error" in signed) {
      toast.error(`${file.name}: ${signed.error}`);
      return null;
    }
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .uploadToSignedUrl(signed.path, signed.token, file);
    if (upErr) {
      toast.error(`${file.name}: ${upErr.message}`);
      return null;
    }
    return signed.path;
  }

  async function uploadFiles(files: File[]) {
    setUploading(files.length);
    let ok = 0;
    for (const file of files) {
      try {
        const path = await uploadOne(file);
        if (!path) continue;
        const attached = await attachProductImage({
          productId,
          productSlug,
          path,
          alt: file.name.replace(/\.[^.]+$/, ""),
        });
        if ("error" in attached) {
          toast.error(`${file.name}: ${attached.error}`);
          continue;
        }
        ok += 1;
      } catch (e) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : "Upload failed"}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (ok) {
      toast.success(ok === 1 ? "Image uploaded." : `${ok} images uploaded.`);
      router.refresh();
    }
  }

  function pickFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    // Straight into the crop queue — nothing uploads until it has been framed
    // or explicitly waved through.
    if (files.length) {
      setSettled([]);
      setWaiting(files);
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  /*
    Retire the file at the head of the queue. `keep` is what should be uploaded
    for it — the cropped version, the original, or nothing. Uploading happens
    once, when the last file has been decided, so the staffer is never waiting
    on the network between crops.
  */
  function advance(keep: File | null) {
    const rest = waiting.slice(1);
    const next = keep ? [...settled, keep] : settled;
    setWaiting(rest);
    if (rest.length) {
      setSettled(next);
    } else {
      setSettled([]);
      if (next.length) void uploadFiles(next);
    }
  }

  /* Stop here: upload what has already been decided, drop the rest. */
  function stopQueue() {
    const done = settled;
    setWaiting([]);
    setSettled([]);
    if (done.length) void uploadFiles(done);
    else toast.message("Upload cancelled.");
  }

  /*
    Re-crop a photo that is already live. The bytes come back through fetch
    rather than being read off an <img>, because a canvas that has drawn a
    cross-origin image cannot be exported — fetch + a blob URL keeps the
    canvas clean, and surfaces a CORS problem as an error we can name.
  */
  async function startRecrop(image: EditImage) {
    setPreparing(true);
    try {
      const res = await fetch(image.url);
      if (!res.ok) throw new Error(`could not be loaded (${res.status})`);
      const blob = await res.blob();
      /* Keep the file's real name and type. This used to relabel everything
         .jpg, which was harmless while every stored photo was one — now that
         the catalogue is WebP it would hand the cropper a .jpg name over WebP
         bytes. The cropper re-encodes and renames anyway; this only has to
         stop being a lie. */
      const name = image.path?.split("/").pop() ?? "image";
      setRecrop({
        image,
        file: new File([blob], name, { type: blob.type || "image/jpeg" }),
      });
    } catch (e) {
      toast.error(`That image ${e instanceof Error ? e.message : "could not be loaded"}.`);
    } finally {
      setPreparing(false);
    }
  }

  async function finishRecrop(cropped: File) {
    const target = recrop;
    if (!target) return;
    setRecrop(null);
    setUploading(1);
    const path = await uploadOne(cropped);
    setUploading(0);
    if (!path) return;

    startTransition(async () => {
      const res = await replaceProductImage({ imageId: target.image.id, productSlug, path });
      if ("error" in res) toast.error(res.error);
      else {
        toast.success("Image re-cropped.");
        router.refresh();
      }
    });
  }

  function onDrop(index: number) {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === index) return;

    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(index, 0, moved);
    setOrder(next);

    startTransition(async () => {
      const res = await reorderProductImages(next.map((i) => i.id), productSlug);
      if ("error" in res) {
        toast.error(res.error);
        setOrder(images); // roll back to the server's truth
      } else {
        router.refresh();
      }
    });
  }

  function saveMeta(image: EditImage, patch: { alt?: string; colorName?: string | null }) {
    startTransition(async () => {
      const res = await updateProductImage({
        imageId: image.id,
        productSlug,
        alt: patch.alt ?? image.alt ?? "",
        colorName: patch.colorName !== undefined ? patch.colorName : image.colorName,
      });
      if ("error" in res) toast.error(res.error);
      else router.refresh();
    });
  }

  function remove(image: EditImage) {
    startTransition(async () => {
      const res = await deleteProductImage(image.id, productSlug);
      if ("error" in res) toast.error(res.error);
      else {
        toast.success("Image removed.");
        router.refresh();
      }
    });
  }

  const queued = waiting[0];

  return (
    <Card>
      {queued && (
        <ImageCropper
          key={`${queued.name}-${queued.size}-${waiting.length}`}
          file={queued}
          title={
            waiting.length > 1
              ? `Crop ${queued.name} — ${waiting.length} left`
              : `Crop ${queued.name}`
          }
          onCancel={stopQueue}
          onSkip={() => advance(queued)}
          onCropped={(cropped) => advance(cropped)}
        />
      )}

      {recrop && (
        <ImageCropper
          file={recrop.file}
          title="Re-crop this photo"
          onCancel={() => setRecrop(null)}
          onCropped={(cropped) => void finishRecrop(cropped)}
        />
      )}

      <CardHeader
        title="Photography"
        action={
          <Button
            type="button"
            variant="kalimaOutline"
            size="editorial"
            disabled={uploading > 0}
            onClick={() => fileInput.current?.click()}
          >
            {uploading > 0 ? `Uploading ${uploading}…` : "Upload images"}
          </Button>
        }
      />

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => pickFiles(e.target.files)}
      />

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          pickFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInput.current?.click()}
        className={`mb-5 cursor-pointer rounded border border-dashed px-4 py-8 text-center transition-colors ${
          dragOver ? "border-navy bg-navy/5" : "border-navy-200 hover:border-navy-400"
        }`}
      >
        <p className="text-[13px] tracking-wide text-navy">
          Drop images here, or click to choose
        </p>
        <p className="mt-1 text-[11px] tracking-wide text-navy-400">
          JPEG, PNG, WebP or AVIF · up to 5 MB each · you&apos;ll crop each one before it
          uploads
        </p>
      </div>

      {order.length === 0 ? (
        <p className="text-[13px] tracking-wide text-navy-400">
          No photography yet. The storefront falls back to the product&apos;s tone gradient
          until an image is added.
        </p>
      ) : (
        <>
          <p className="mb-3 text-[11px] tracking-wide text-navy-400">
            Drag to reorder. The first image with no colour is the hero shot; giving an
            image a colour makes it that colourway&apos;s swatch photo.
          </p>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {order.map((image, index) => (
              <li
                key={image.id}
                draggable={!pending}
                onDragStart={() => (dragIndex.current = index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(index)}
                className="group rounded border border-navy-100 bg-white p-2 transition-shadow hover:shadow-sm"
              >
                <div className="relative aspect-[3/4] overflow-hidden rounded bg-cream">
                  <Image
                    src={image.url}
                    alt={image.alt ?? ""}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="object-cover"
                  />
                  {image.id === hero?.id && (
                    <span className="absolute left-2 top-2">
                      <Chip>Hero</Chip>
                    </span>
                  )}
                  <span className="absolute right-2 top-2 cursor-grab rounded bg-white/85 px-1.5 py-0.5 text-[11px] tracking-wide text-navy-400">
                    ⠿ {index + 1}
                  </span>
                </div>

                <div className="mt-2 space-y-2">
                  <Input
                    defaultValue={image.alt ?? ""}
                    placeholder="Alt text"
                    className="h-8 text-[12px]"
                    onBlur={(e) => {
                      if (e.target.value !== (image.alt ?? "")) saveMeta(image, { alt: e.target.value });
                    }}
                  />
                  <Select
                    value={image.colorName ?? NO_COLOR}
                    onValueChange={(v) =>
                      saveMeta(image, { colorName: v === NO_COLOR ? null : v })
                    }
                  >
                    <SelectTrigger className="h-8 text-[12px]">
                      <SelectValue placeholder="Product-level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_COLOR}>Product-level (hero)</SelectItem>
                      {colors.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="kalimaOutline"
                      size="editorial"
                      disabled={pending || preparing || uploading > 0}
                      onClick={() => void startRecrop(image)}
                    >
                      {preparing ? "Opening…" : "Crop"}
                    </Button>
                    <Button
                      type="button"
                      variant="kalimaOutline"
                      size="editorial"
                      disabled={pending}
                      onClick={() => remove(image)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
