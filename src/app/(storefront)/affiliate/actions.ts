"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/catalog-csv";

export type ActionResult = { ok: true } | { error: string };

/*
  Affiliate application.

  Creates a PENDING row — never an approved one. Approval is a staff decision,
  and self-approval would make every fraud guard downstream pointless, since a
  pending affiliate earns nothing.
*/
export async function applyAsAffiliate(input: {
  name: string;
  slug: string;
}): Promise<ActionResult> {
  const current = await getCurrentUser();
  if (!current?.user.email) return { error: "Please sign in to apply." };

  const db = createAdminClient();
  if (!db) return { error: "Applications are not configured yet." };

  const name = input.name.trim();
  const slug = slugify(input.slug || name);
  if (!name) return { error: "Please enter the name you want to be known by." };
  if (!slug) return { error: "Please choose a referral link name." };
  if (slug.length < 3) return { error: "Referral link name must be at least 3 characters." };

  const { data: taken } = await db
    .from("affiliates").select("id").eq("slug", slug).maybeSingle();
  if (taken) return { error: `The link name "${slug}" is already taken.` };

  const { error } = await db.from("affiliates").insert({
    user_id: current.user.id,
    email: current.user.email,
    name,
    slug,
    status: "pending",
  });
  if (error) {
    return {
      error: error.message.includes("unique")
        ? "You have already applied — we'll be in touch."
        : error.message,
    };
  }

  revalidatePath("/affiliate");
  return { ok: true };
}
