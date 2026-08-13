"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  clearProductSizeChart,
  createImageUploadUrl,
  setProductSizeChart,
} from "@/app/admin/actions";
import { ImageCropper } from "@/components/admin/ImageCropper";
import { Card, CardHeader } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "product-images";
const ACCEPT = "image/jpeg,image/png,image/webp,image/avif";

/*
  The product's size chart — one image, no colour scope, shown behind the PDP's
  "Size guide" link.

  It is deliberately not part of the Photography card: everything there is
  merchandising, ordered, and one drag away from becoming the hero shot. A
  measurements table is a document, so it gets its own slot and its own column
  on the product row.

  Upload takes the same browser → Storage signed-URL route as the photography,
  and the same optional crop, because a chart screenshotted off a phone usually
  needs its margins trimmed.
*/
export function SizeChart({
  productId,
  productSlug,
  url,
}: {
  productId: string;
  productSlug: string;
  url: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [picked, setPicked] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    const supabase = createClient();
    if (!supabase) return toast.error("Storage is not configured.");

    setUploading(true);
    try {
      const signed = await createImageUploadUrl(productId, file.type, file.size);
      if ("error" in signed) return toast.error(signed.error);

      const { error } = await supabase.storage
        .from(BUCKET)
        .uploadToSignedUrl(signed.path, signed.token, file);
      if (error) return toast.error(error.message);

      const res = await setProductSizeChart({ productId, productSlug, path: signed.path });
      if ("error" in res) return toast.error(res.error);

      toast.success("Size chart saved.");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function remove() {
    startTransition(async () => {
      const res = await clearProductSizeChart(productId, productSlug);
      if ("error" in res) toast.error(res.error);
      else {
        toast.success("Size chart removed.");
        router.refresh();
      }
    });
  }

  const busy = uploading || pending;

  return (
    <Card>
      {picked && (
        <ImageCropper
          file={picked}
          title="Crop the size chart"
          busy={busy}
          onCancel={() => setPicked(null)}
          onSkip={() => {
            const file = picked;
            setPicked(null);
            void upload(file);
          }}
          onCropped={(cropped) => {
            setPicked(null);
            void upload(cropped);
          }}
        />
      )}

      <CardHeader
        title="Size chart"
        action={
          <Button
            type="button"
            variant="kalimaOutline"
            size="editorial"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? "Uploading…" : url ? "Replace" : "Upload size chart"}
          </Button>
        }
      />

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) setPicked(file);
          if (fileInput.current) fileInput.current.value = "";
        }}
      />

      <div className="px-5 py-5">
        {url ? (
          <div className="flex flex-wrap items-start gap-5">
            <div className="relative h-56 w-44 shrink-0 overflow-hidden rounded border border-navy-100 bg-cream">
              <Image
                src={url}
                alt="Size chart"
                fill
                sizes="176px"
                className="object-contain"
              />
            </div>
            <div className="space-y-3">
              <p className="max-w-md text-[13px] leading-relaxed tracking-wide text-navy-400">
                Shown when a shopper taps <span className="text-navy">Size guide</span> on this
                product. It belongs to the product, not to a colourway, so every colour shows
                the same chart.
              </p>
              <Button
                type="button"
                variant="kalimaOutline"
                size="editorial"
                disabled={busy}
                onClick={remove}
              >
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => fileInput.current?.click()}
            className="cursor-pointer rounded border border-dashed border-navy-200 px-4 py-8 text-center transition-colors hover:border-navy-400"
          >
            <p className="text-[13px] tracking-wide text-navy">
              No size chart yet — click to upload one
            </p>
            <p className="mt-1 text-[11px] tracking-wide text-navy-400">
              Shoppers fall back to the general size guide page until one is added.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
