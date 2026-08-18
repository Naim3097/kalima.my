"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  deleteFooterColumn,
  deleteFooterLink,
  deleteTrustItem,
  saveFooterColumn,
  saveFooterLink,
  saveFooterText,
  saveTrustItem,
} from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TRUST_ICON_KEYS, trustIcon } from "@/lib/trust-icons";
import type { AdminFooterColumn, AdminFooterLink, AdminFooterText, AdminTrustItem } from "@/lib/admin";

/*
  The footer, editable.

  Three groups, because the footer is three kinds of content and they fail
  differently. The TEXT is a form with a Save — it is one coherent statement
  about the company and half-saving it is worse than not. The STRIP and the
  LINKS are lists, so each row is its own dialog and its own save; batching a
  list behind one button only invents a way to lose half of it.

  Ordering is a number rather than drag-and-drop. The footer has three columns
  and a handful of links in each; a drag surface is more code to maintain than
  the problem is worth, and a number is unambiguous on a phone.
*/

export function FooterEditor({
  text,
  trust,
  columns,
}: {
  text: AdminFooterText;
  trust: AdminTrustItem[];
  columns: AdminFooterColumn[];
}) {
  return (
    <div className="divide-y divide-navy/10">
      <FooterTextForm text={text} />
      <TrustStrip items={trust} />
      <LinkColumns columns={columns} />
    </div>
  );
}

/* ---- Text ---------------------------------------------------------------- */

function FooterTextForm({ text }: { text: AdminFooterText }) {
  const [pending, startTransition] = useTransition();
  const [companyName, setCompanyName] = useState(text.companyName);
  const [companyRegNo, setCompanyRegNo] = useState(text.companyRegNo);
  const [tagline, setTagline] = useState(text.tagline);
  const [paymentNote, setPaymentNote] = useState(text.paymentNote);

  function save() {
    startTransition(async () => {
      const res = await saveFooterText({ companyName, companyRegNo, tagline, paymentNote });
      if ("error" in res) toast.error(res.error);
      else toast.success("Footer text saved.");
    });
  }

  return (
    <div className="px-5 py-5">
      <p className="label-caps mb-4 text-navy-400">Company &amp; wording</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="footer-company" className="label-caps text-navy-400">
            Registered name
          </Label>
          <Input
            id="footer-company"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="KALIMA GROUP TRADING (M) SDN. BHD."
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="footer-reg" className="label-caps text-navy-400">
            Company registration no.
          </Label>
          <Input
            id="footer-reg"
            value={companyRegNo}
            onChange={(e) => setCompanyRegNo(e.target.value)}
            placeholder="202101012868 (1413167-V)"
          />
        </div>
      </div>
      <p className="mt-2 text-[12px] tracking-wide text-navy-400">
        Shown on every page. A Malaysian company has to identify itself on its commercial
        communications, so leaving these blank removes something the shop is required to show.
      </p>

      <div className="mt-4 space-y-2">
        <Label htmlFor="footer-tagline" className="label-caps text-navy-400">
          Tagline under the logo
        </Label>
        <Input
          id="footer-tagline"
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          placeholder="Timeless modest luxury — designed in Malaysia…"
        />
      </div>

      <div className="mt-4 space-y-2">
        <Label htmlFor="footer-payment" className="label-caps text-navy-400">
          Payment note
        </Label>
        <Input
          id="footer-payment"
          value={paymentNote}
          onChange={(e) => setPaymentNote(e.target.value)}
          placeholder="FPX · Visa · Mastercard · GrabPay — secure checkout"
        />
      </div>

      <div className="mt-5">
        <Button variant="kalima" size="sm" className="cursor-pointer" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save text"}
        </Button>
      </div>
    </div>
  );
}

/* ---- Trust strip --------------------------------------------------------- */

function TrustStrip({ items }: { items: AdminTrustItem[] }) {
  return (
    <div className="px-5 py-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="label-caps text-navy-400">Trust strip</p>
        <TrustItemEditor nextOrder={items.length} />
      </div>

      {items.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-navy-400">
          Nothing here — the storefront falls back to its four built-in items.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const Icon = trustIcon(item.icon);
            return (
              <li
                key={item.id}
                className="flex items-center gap-3 border border-navy/10 px-4 py-3"
              >
                <Icon size={22} className="shrink-0 text-navy" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-navy">
                    {item.title}
                    {!item.active && <span className="ml-2 text-[11px] text-navy-400">hidden</span>}
                  </p>
                  <p className="truncate text-[12px] text-navy-400">{item.body ?? "—"}</p>
                </div>
                <TrustItemEditor item={item} nextOrder={item.sortOrder} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TrustItemEditor({ item, nextOrder }: { item?: AdminTrustItem; nextOrder: number }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [icon, setIcon] = useState(item?.icon ?? "truck");
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(item?.body ?? "");
  const [sortOrder, setSortOrder] = useState(String(item?.sortOrder ?? nextOrder));
  const [active, setActive] = useState(item?.active ?? true);

  function submit() {
    startTransition(async () => {
      const res = await saveTrustItem({
        id: item?.id,
        icon,
        title,
        body,
        sortOrder: Math.round(Number(sortOrder) || 0),
        active,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(item ? "Item updated." : "Item added.");
      setOpen(false);
    });
  }

  function remove() {
    if (!item) return;
    startTransition(async () => {
      const res = await deleteTrustItem(item.id);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Item removed.");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="kalimaOutline" size="sm" className="cursor-pointer">
          {item ? "Edit" : "Add item"}
        </Button>
      </DialogTrigger>
      <DialogContent className="border-navy/10">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-navy">
            {item ? "Edit trust item" : "New trust item"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="label-caps text-navy-400">Icon</Label>
            <Select value={icon} onValueChange={setIcon}>
              <SelectTrigger className="cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRUST_ICON_KEYS.map((key) => {
                  const Icon = trustIcon(key);
                  return (
                    <SelectItem key={key} value={key}>
                      <span className="flex items-center gap-2">
                        <Icon size={16} /> {key}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="trust-title" className="label-caps text-navy-400">Title</Label>
            <Input id="trust-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Worldwide Delivery" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="trust-body" className="label-caps text-navy-400">Sub-line</Label>
            <Input id="trust-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Rates shown at checkout" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="trust-order" className="label-caps text-navy-400">Order</Label>
            <Input id="trust-order" type="number" step={1} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-navy">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-navy" />
            Shown on the storefront
          </label>
        </div>

        <DialogActions
          pending={pending}
          onCancel={() => setOpen(false)}
          onSave={submit}
          onDelete={item ? remove : undefined}
          saveLabel={item ? "Save changes" : "Add"}
        />
      </DialogContent>
    </Dialog>
  );
}

/* ---- Link columns -------------------------------------------------------- */

function LinkColumns({ columns }: { columns: AdminFooterColumn[] }) {
  return (
    <div className="px-5 py-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="label-caps text-navy-400">Link columns</p>
        <ColumnEditor nextOrder={columns.length} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {columns.map((col) => (
          <div key={col.id} className="border border-navy/10">
            <div className="flex items-center justify-between border-b border-navy/10 px-4 py-3">
              <p className="text-[13px] font-medium text-navy">{col.heading}</p>
              <ColumnEditor column={col} nextOrder={col.sortOrder} />
            </div>
            <ul className="divide-y divide-navy/5">
              {col.links.map((link) => (
                <li key={link.id} className="flex items-center gap-2 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-navy">
                      {link.label}
                      {!link.active && <span className="ml-2 text-[11px] text-navy-400">hidden</span>}
                    </p>
                    <p className="truncate font-mono text-[11px] text-navy-400">{link.href}</p>
                  </div>
                  <LinkEditor columnId={col.id} link={link} nextOrder={link.sortOrder} />
                </li>
              ))}
            </ul>
            <div className="px-4 py-3">
              <LinkEditor columnId={col.id} nextOrder={col.links.length} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ColumnEditor({ column, nextOrder }: { column?: AdminFooterColumn; nextOrder: number }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [heading, setHeading] = useState(column?.heading ?? "");
  const [sortOrder, setSortOrder] = useState(String(column?.sortOrder ?? nextOrder));

  function submit() {
    startTransition(async () => {
      const res = await saveFooterColumn({
        id: column?.id,
        heading,
        sortOrder: Math.round(Number(sortOrder) || 0),
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(column ? "Column saved." : "Column added.");
      setOpen(false);
    });
  }

  function remove() {
    if (!column) return;
    startTransition(async () => {
      const res = await deleteFooterColumn(column.id);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Column removed.");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="kalimaOutline" size="sm" className="cursor-pointer">
          {column ? "Edit" : "Add column"}
        </Button>
      </DialogTrigger>
      <DialogContent className="border-navy/10">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-navy">
            {column ? "Edit column" : "New column"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="col-heading" className="label-caps text-navy-400">Heading</Label>
            <Input id="col-heading" value={heading} onChange={(e) => setHeading(e.target.value)} placeholder="Help" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="col-order" className="label-caps text-navy-400">Order</Label>
            <Input id="col-order" type="number" step={1} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </div>
          {column && column.links.length > 0 && (
            <p className="text-[12px] tracking-wide text-navy-400">
              Deleting this column also deletes its {column.links.length} link
              {column.links.length === 1 ? "" : "s"}.
            </p>
          )}
        </div>

        <DialogActions
          pending={pending}
          onCancel={() => setOpen(false)}
          onSave={submit}
          onDelete={column ? remove : undefined}
          saveLabel={column ? "Save changes" : "Add"}
        />
      </DialogContent>
    </Dialog>
  );
}

function LinkEditor({
  columnId,
  link,
  nextOrder,
}: {
  columnId: string;
  link?: AdminFooterLink;
  nextOrder: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState(link?.label ?? "");
  const [href, setHref] = useState(link?.href ?? "");
  const [sortOrder, setSortOrder] = useState(String(link?.sortOrder ?? nextOrder));
  const [active, setActive] = useState(link?.active ?? true);

  function submit() {
    startTransition(async () => {
      const res = await saveFooterLink({
        id: link?.id,
        columnId,
        label,
        href,
        sortOrder: Math.round(Number(sortOrder) || 0),
        active,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(link ? "Link saved." : "Link added.");
      setOpen(false);
    });
  }

  function remove() {
    if (!link) return;
    startTransition(async () => {
      const res = await deleteFooterLink(link.id);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Link removed.");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="kalimaOutline" size="sm" className="cursor-pointer">
          {link ? "Edit" : "Add link"}
        </Button>
      </DialogTrigger>
      <DialogContent className="border-navy/10">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-navy">
            {link ? "Edit link" : "New link"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="link-label" className="label-caps text-navy-400">Label</Label>
            <Input id="link-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Size Guide" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="link-href" className="label-caps text-navy-400">Links to</Label>
            <Input id="link-href" value={href} onChange={(e) => setHref(e.target.value)} placeholder="/pages/size-guide" />
            <p className="text-[12px] tracking-wide text-navy-400">
              A path on this site (/pages/size-guide) or a full https:// address.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="link-order" className="label-caps text-navy-400">Order</Label>
            <Input id="link-order" type="number" step={1} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-navy">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-navy" />
            Shown on the storefront
          </label>
        </div>

        <DialogActions
          pending={pending}
          onCancel={() => setOpen(false)}
          onSave={submit}
          onDelete={link ? remove : undefined}
          saveLabel={link ? "Save changes" : "Add"}
        />
      </DialogContent>
    </Dialog>
  );
}

/* Shared dialog footer — Delete on the left, Cancel/Save on the right, exactly
   as the hero and lookbook editors already do it. */
function DialogActions({
  pending,
  onCancel,
  onSave,
  onDelete,
  saveLabel,
}: {
  pending: boolean;
  onCancel: () => void;
  onSave: () => void;
  onDelete?: () => void;
  saveLabel: string;
}) {
  return (
    <div className="flex items-center justify-between pt-2">
      <div>
        {onDelete && (
          <Button
            variant="kalimaOutline"
            size="sm"
            className="cursor-pointer border-red-300 text-red-700 hover:bg-red-50"
            onClick={onDelete}
            disabled={pending}
          >
            Delete
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="kalimaOutline" size="sm" className="cursor-pointer" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button variant="kalima" size="sm" className="cursor-pointer" onClick={onSave} disabled={pending}>
          {pending ? "Saving…" : saveLabel}
        </Button>
      </div>
    </div>
  );
}
