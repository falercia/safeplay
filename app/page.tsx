import type { Metadata } from "next";
import { StartScreen } from "@/components/game/start-screen";

export const metadata: Metadata = { title: "Arena Nimbus" };

export default function Home() {
  return <StartScreen />;
}
