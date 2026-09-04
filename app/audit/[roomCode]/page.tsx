import type { Metadata } from "next";
import { AuditPage } from "@/components/audit/audit-page";

export const metadata: Metadata = { title: "Transparência e auditoria" };

export default async function Audit({ params, searchParams }: { params: Promise<{ roomCode: string }>; searchParams: Promise<{ t?: string }> }) {
  const { roomCode } = await params;
  const { t } = await searchParams;
  return <AuditPage roomCode={roomCode} token={t ?? null} />;
}
