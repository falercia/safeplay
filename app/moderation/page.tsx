import type { Metadata } from "next";
import { ModerationCenter } from "@/components/moderation/moderation-center";

export const metadata: Metadata = { title: "Central de moderação" };

export default async function ModerationPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  return <ModerationCenter token={t ?? null} />;
}
