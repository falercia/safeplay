import type { Metadata } from "next";
import { GuardianPanel } from "@/components/guardian/guardian-panel";

export const metadata: Metadata = { title: "Painel do responsável" };

export default async function GuardianPage({ params, searchParams }: { params: Promise<{ roomCode: string }>; searchParams: Promise<{ t?: string }> }) {
  const { roomCode } = await params;
  const { t } = await searchParams;
  return <GuardianPanel roomCode={roomCode} token={t ?? null} />;
}
