import type { Metadata } from "next";
import { DemoCenter } from "@/components/demo/demo-center";

export const metadata: Metadata = { title: "Central da demonstração" };

export default function DemoPage() {
  return <DemoCenter />;
}
