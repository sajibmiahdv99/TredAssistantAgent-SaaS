import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type KycStatus = "not_started" | "pending" | "verified" | "rejected";

/**
 * Document metadata attached to a KYC submission.
 * The kyc_verifications table has no dedicated columns for these fields, so the
 * metadata is persisted as JSON inside external_reference_id (with a prefix to
 * avoid colliding with real external provider references). This keeps the
 * implementation migration-friendly — it works against the existing schema
 * without requiring new columns or a new migration.
 */
type KycDocumentMetadata = {
  name?: string | null;
  document_type?: string | null;
  document_number?: string | null;
  document_url?: string | null;
  country?: string | null;
};

const KYC_METADATA_PREFIX = "kyc_meta:";

function encodeKycMetadata(meta: KycDocumentMetadata): string {
  return `${KYC_METADATA_PREFIX}${JSON.stringify(meta)}`;
}

function decodeKycMetadata(externalReferenceId: string | null): KycDocumentMetadata {
  if (!externalReferenceId?.startsWith(KYC_METADATA_PREFIX)) return {};
  try {
    return JSON.parse(externalReferenceId.slice(KYC_METADATA_PREFIX.length)) as KycDocumentMetadata;
  } catch {
    return {};
  }
}

async function assertAdmin(sb: SupabaseClient<Database>, userId: string) {
  const { data, error } = await sb.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

/**
 * Inserts (or re-opens) the user's pending KYC submission.
 * kyc_verifications.user_id is UNIQUE, so re-submission after a rejection
 * updates the existing row back to 'pending' instead of inserting a duplicate.
 * Writes go through the service-role client because INSERT/UPDATE on
 * kyc_verifications are service-role only under RLS.
 */
async function upsertPendingKyc(sb: SupabaseClient<Database>, userId: string, meta: KycDocumentMetadata) {
  const { data: existing, error: readError } = await sb
    .from("kyc_verifications")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  if (existing?.status === "pending") {
    throw new Error("KYC verification is already pending review.");
  }
  if (existing?.status === "verified") {
    throw new Error("KYC verification has already been completed.");
  }

  const payload = {
    provider: "manual",
    status: "pending",
    submitted_at: new Date().toISOString(),
    verified_at: null,
    rejected_reason: null,
    external_reference_id: encodeKycMetadata(meta),
  };

  const { error } = existing
    ? await sb.from("kyc_verifications").update(payload).eq("user_id", userId)
    : await sb.from("kyc_verifications").insert({ ...payload, user_id: userId });
  if (error) throw new Error(error.message);
}

export const getMyKycStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("kyc_verifications")
      .select("status,provider,submitted_at,verified_at,rejected_reason,updated_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return {
        status: "not_started" as KycStatus,
        provider: null as string | null,
        submitted_at: null as string | null,
        verified_at: null as string | null,
        rejected_reason: null as string | null,
        updated_at: null as string | null,
      };
    }
    return { ...data, status: data.status as KycStatus };
  });

/**
 * Kicks off manual KYC verification for the current user. Input is optional so
 * the existing "Start verification" button (which calls this with no args) keeps
 * working without a form; when provided, the fields are validated. Full document
 * submissions with required metadata should use submitKycDocument instead.
 */
export const requestKycVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        name: z.string().min(1).max(120).optional(),
        document_type: z.string().min(1).max(32).optional(),
        document_number: z.string().min(1).max(64).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await upsertPendingKyc(supabaseAdmin, context.userId, {
      name: data.name ?? null,
      document_type: data.document_type ?? null,
      document_number: data.document_number ?? null,
    });
    return { ok: true, status: "pending" as KycStatus };
  });

/**
 * Submits a full KYC document for review. The document file itself is uploaded
 * to storage client-side; only its metadata (and optional storage URL) is
 * persisted here.
 */
export const submitKycDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        document_type: z.enum(["passport", "national_id", "drivers_license"]),
        document_number: z.string().min(3).max(64),
        full_name: z.string().min(1).max(120),
        country: z.string().min(2).max(64),
        document_url: z.string().url().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await upsertPendingKyc(supabaseAdmin, context.userId, {
      name: data.full_name,
      document_type: data.document_type,
      document_number: data.document_number,
      country: data.country,
      document_url: data.document_url ?? null,
    });
    return { ok: true, status: "pending" as KycStatus };
  });

/**
 * Admin review: approve or reject a KYC submission. Uses the service-role
 * client because kyc_verifications UPDATE is service-role only under RLS.
 */
export const adminReviewKyc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        action: z.enum(["approve", "reject"]),
        rejected_reason: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const update =
      data.action === "approve"
        ? { status: "verified", verified_at: new Date().toISOString(), rejected_reason: null }
        : { status: "rejected", verified_at: null, rejected_reason: data.rejected_reason ?? "Not approved" };
    const { error } = await supabaseAdmin.from("kyc_verifications").update(update).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Admin listing of KYC submissions (all, or filtered by status), most recent
 * first. Uses the service-role client because RLS only exposes a user's own row.
 * Decodes the persisted document metadata (name/document_type/document_number/
 * document_url/country) and hydrates the submitting user's profile.
 */
export const listKycSubmissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        status: z.enum(["pending", "verified", "rejected", "not_started"]).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .partial()
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let query = supabaseAdmin
      .from("kyc_verifications")
      .select("id,user_id,provider,status,external_reference_id,submitted_at,verified_at,rejected_reason,created_at,updated_at")
      .order("submitted_at", { ascending: false })
      .limit(data.limit ?? 200);
    if (data.status) query = query.eq("status", data.status);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id).filter(Boolean)));
    const { data: profiles } = userIds.length
      ? await supabaseAdmin.from("profiles").select("id,email,full_name").in("id", userIds)
      : { data: [] as Array<{ id: string; email: string; full_name: string | null }> };
    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

    return (rows ?? []).map((row) => ({
      ...row,
      ...decodeKycMetadata(row.external_reference_id),
      profile: profileMap.get(row.user_id) ?? null,
    }));
  });
