import type { Metadata } from "next";
import ProductImage from "@/components/brand/ProductImage";
import { AnnouncementEditor } from "@/components/admin/cms/AnnouncementEditor";
import { ContentPageEditor } from "@/components/admin/cms/ContentPageEditor";
import { EditorialImageEditor } from "@/components/admin/cms/EditorialImageEditor";
import { FooterEditor } from "@/components/admin/cms/FooterEditor";
import { HeroSlideEditor } from "@/components/admin/cms/HeroSlideEditor";
import { InstagramPosts } from "@/components/admin/cms/InstagramPosts";
import { SignupPromoEditor } from "@/components/admin/cms/SignupPromoEditor";
import { LookbookEditor } from "@/components/admin/cms/LookbookEditor";
import { Card, CardHeader, Pill, Table, Td, Tr } from "@/components/admin/ui";
import {
  listAnnouncements,
  listContentPages,
  listEditorialImages,
  listHeroSlides,
  getFooterText,
  getSignupPromoAdmin,
  listFooterColumns,
  listInstagramPosts,
  listTaggableProducts,
  listTrustItems,
  listLookbookCandidates,
  listLookbookShots,
} from "@/lib/admin";

export const metadata: Metadata = {
  title: "Content · Admin",
  description:
    "Edit the storefront announcement bar, homepage hero slides, the Lookbook and content pages.",
};

/* Server Component — live CMS content pulled straight from the storefront tables. */
export default async function AdminCmsPage() {
  const [
    announcements,
    heroSlides,
    editorialImages,
    contentPages,
    lookbookShots,
    lookbookCandidates,
    instagramPosts,
    taggableProducts,
    footerText,
    trustItems,
    footerColumns,
    signupPromo,
  ] = await Promise.all([
    listAnnouncements(),
    listHeroSlides(),
    listEditorialImages(),
    listContentPages(),
    listLookbookShots(),
    listLookbookCandidates(),
    listInstagramPosts(),
    listTaggableProducts(),
    getFooterText(),
    listTrustItems(),
    listFooterColumns(),
    getSignupPromoAdmin(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl text-navy">Content</h1>
        <p className="mt-1 max-w-2xl text-[13px] tracking-wide text-navy-400">
          These sections edit the live storefront directly — the announcement bar, the homepage hero
          carousel, the Lookbook row and the standalone content pages. Changes publish as soon as
          you save.
        </p>
      </div>

      {/* Announcement bar */}
      <Card>
        <CardHeader
          title="Announcement bar"
          action={<AnnouncementEditor />}
        />
        {announcements.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-navy-400">
            No announcements yet. Add your first with “New message”.
          </p>
        ) : (
          <Table head={["Message", "Order", "Status", ""]}>
            {announcements.map((a) => (
              <Tr key={a.id}>
                <Td className="whitespace-normal text-navy">{a.text}</Td>
                <Td className="text-navy-400">{a.sortOrder}</Td>
                <Td>
                  <Pill value={a.active ? "active" : "draft"} />
                </Td>
                <Td className="text-right">
                  <AnnouncementEditor announcement={a} />
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Hero slides */}
      <Card>
        <CardHeader title="Hero slides" action={<HeroSlideEditor />} />
        {heroSlides.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-navy-400">
            No hero slides yet. Add your first with “New slide”.
          </p>
        ) : (
          <Table head={["Slide", "Image", "Order", "Status", ""]}>
            {heroSlides.map((s) => (
              <Tr key={s.id}>
                <Td className="whitespace-normal">
                  <div className="flex items-center gap-3">
                    <div className="relative h-12 w-10 shrink-0 overflow-hidden rounded bg-navy-100">
                      <ProductImage
                        image={s.image}
                        tone="#1e2a44"
                        alt={s.title}
                        sizes="40px"
                        position={s.focal ?? undefined}
                        zoom={s.zoom}
                        className="object-cover"
                      />
                    </div>
                    <div>
                      <p className="font-medium text-navy">{s.title}</p>
                      {s.eyebrow && (
                        <p className="text-[12px] text-navy-400">{s.eyebrow}</p>
                      )}
                    </div>
                  </div>
                </Td>
                <Td className="font-mono text-[12px] text-navy-400">{s.image}</Td>
                <Td className="text-navy-400">{s.sortOrder}</Td>
                <Td>
                  <Pill value={s.active ? "active" : "draft"} />
                </Td>
                <Td className="text-right">
                  <HeroSlideEditor slide={s} />
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Homepage imagery — the category tiles and the collection spotlight */}
      <Card>
        <CardHeader title="Homepage imagery" />
        <p className="border-b border-navy/10 px-5 pb-4 text-[13px] tracking-wide text-navy-400">
          The three category tiles and the collection spotlight. Upload a photograph and frame it —
          the wording and the links are part of the page layout, not content.
        </p>
        <Table head={["Section", "Image", "Framing", "Source", ""]}>
          {editorialImages.map((shot) => (
            <Tr key={shot.slot}>
              <Td className="whitespace-normal">
                <div className="flex items-center gap-3">
                  <div className="relative h-12 w-10 shrink-0 overflow-hidden rounded bg-navy-100">
                    <ProductImage
                      image={shot.image}
                      tone="#efe7db"
                      alt={shot.alt}
                      sizes="40px"
                      position={shot.focal}
                      zoom={shot.zoom}
                      className="object-cover"
                    />
                  </div>
                  <p className="font-medium text-navy">{shot.label}</p>
                </div>
              </Td>
              <Td className="font-mono text-[12px] text-navy-400">{shot.image}</Td>
              <Td className="text-[12px] text-navy-400">
                {shot.focal}
                {shot.zoom > 1 ? ` · ${shot.zoom.toFixed(2)}×` : ""}
              </Td>
              <Td>
                <Pill value={shot.customised ? "custom" : "default"} />
              </Td>
              <Td className="text-right">
                <EditorialImageEditor shot={shot} />
              </Td>
            </Tr>
          ))}
        </Table>
      </Card>

      {/* Instagram — the homepage Lookbook strip */}
      <Card>
        <CardHeader title="Instagram" />
        <InstagramPosts posts={instagramPosts} products={taggableProducts} />
      </Card>

      {/* Lookbook */}
      <Card>
        <CardHeader
          title="Lookbook"
          action={<LookbookEditor candidates={lookbookCandidates} />}
        />
        {/*
          Said plainly, because the alternative is somebody curating shots into
          a void. The homepage strip is Instagram-only now; these rows are kept
          and still editable, but nothing on the storefront renders them.
        */}
        <p className="border-b border-navy/10 bg-cream-50 px-5 py-3 text-[13px] tracking-wide text-navy-400">
          Not shown on the homepage. That section is the Instagram strip now — these
          shots are kept for a future use and appear nowhere on the storefront today.
        </p>
        {lookbookShots.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-navy-400">
            No Lookbook shots yet. Add your first with “New shot”.
          </p>
        ) : (
          <Table head={["Piece", "Colourway", "Order", "Status", ""]}>
            {lookbookShots.map((s) => (
              <Tr key={s.id}>
                <Td className="whitespace-normal">
                  <p className="font-medium text-navy">{s.productName}</p>
                  <p className="font-mono text-[12px] text-navy-400">/{s.slug}</p>
                </Td>
                <Td className="text-navy">
                  {s.colorName}
                  {/* A shot whose photo was deleted after the fact is dropped on
                      the storefront — silent for a shopper, and useless for
                      staff unless it is said here. */}
                  {!s.hasImage && (
                    <span className="block text-[11px] text-red-700">
                      no photo — this shot is hidden
                    </span>
                  )}
                </Td>
                <Td className="text-navy-400">{s.sortOrder}</Td>
                <Td>
                  <Pill value={s.active ? "active" : "draft"} />
                </Td>
                <Td className="text-right">
                  <LookbookEditor shot={s} candidates={lookbookCandidates} />
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Sign-up popup */}
      <Card>
        <CardHeader
          title="Sign-up popup"
          action={
            <Pill value={signupPromo.enabled ? "live" : "off"} />
          }
        />
        <SignupPromoEditor promo={signupPromo} />
      </Card>

      {/* Footer */}
      <Card>
        <CardHeader title="Footer" />
        <FooterEditor text={footerText} trust={trustItems} columns={footerColumns} />
      </Card>

      {/* Content pages */}
      <Card>
        <CardHeader title="Content pages" action={<ContentPageEditor />} />
        {contentPages.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-navy-400">
            No content pages yet. Add your first with “New page”.
          </p>
        ) : (
          <Table head={["Slug", "Title", "Paragraphs", "Status", ""]}>
            {contentPages.map((p) => (
              <Tr key={p.id}>
                <Td className="font-mono text-navy">/{p.slug}</Td>
                <Td>{p.title}</Td>
                <Td className="text-navy-400">
                  {p.body.length} {p.body.length === 1 ? "paragraph" : "paragraphs"}
                </Td>
                <Td>
                  <Pill value={p.published ? "active" : "draft"} />
                </Td>
                <Td className="text-right">
                  <ContentPageEditor page={p} />
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
