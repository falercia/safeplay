import type { Metadata } from "next";
import { GuardianPanel } from "@/components/guardian/guardian-panel";

export const metadata: Metadata = { title: "Responsável" };

export default function GuardianPage() {
  return <GuardianPanel />;
}
