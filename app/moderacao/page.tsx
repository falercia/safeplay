import type { Metadata } from "next";
import { ModerationCenter } from "@/components/moderation/moderation-center";

export const metadata: Metadata = { title: "Moderação" };

export default function ModerationPage() {
  return <ModerationCenter />;
}
