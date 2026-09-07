import type { Metadata } from "next";
import { WorldScreen } from "@/components/game/world-screen";

export const metadata: Metadata = { title: "Mundo" };

export default async function WorldPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <WorldScreen worldCode={code.toUpperCase()} />;
}
