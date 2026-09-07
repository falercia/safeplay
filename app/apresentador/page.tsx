import type { Metadata } from "next";
import { PresenterCenter } from "@/components/presenter/presenter-center";

export const metadata: Metadata = { title: "Apresentador" };

export default function PresenterPage() {
  return <PresenterCenter />;
}
