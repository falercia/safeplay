import type { Metadata } from "next";
import { EnterScreen } from "@/components/game/enter-screen";

export const metadata: Metadata = { title: "Entrar" };

export default function EnterPage() {
  return <EnterScreen />;
}
