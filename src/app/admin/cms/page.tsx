import type { Metadata } from "next";
import ProductImage from "@/components/brand/ProductImage";
import { AnnouncementEditor } from "@/components/admin/cms/AnnouncementEditor";
import { ContentPageEditor } from "@/components/admin/cms/ContentPageEditor";
import { HeroSlideEditor } from "@/components/admin/cms/HeroSlideEditor";
import { Card, CardHeader, Pill, Table, Td, Tr } from "@/components/admin/ui";
import { listAnnouncements, listContentPages, listHeroSlides } from "@/lib/admin";

export const metadata: Metadata = {
  title: "Content · Admin",
  description: "Edit the storefront announcement bar, homepage hero slides and content pages.",
};

/* Server Component — live CMS content pulled straight from the storefront tables. */
export default async function AdminCmsPage() {
  const [announcements, heroSlides, contentPages] = await Promise.all([
    listAnnouncements(),
    listHeroSlides(),
    listContentPages(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl text-navy">Content</h1>
        <p className="mt-1 max-w-2xl text-[13px] tracking-wide text-navy-400">
          These sections edit the live storefront directly — the announcement bar, the homepage hero
          carousel and the standalone content pages. Changes publish as soon as you save.
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
