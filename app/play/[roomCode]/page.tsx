import type { Metadata } from "next";
import { ChatRoom } from "@/components/chat/chat-room";

export const metadata: Metadata = { title: "Sala de jogo" };

export default async function PlayPage({ params, searchParams }: { params: Promise<{ roomCode: string }>; searchParams: Promise<{ t?: string }> }) {
  const { roomCode } = await params;
  const { t } = await searchParams;
  return <ChatRoom roomCode={roomCode} token={t ?? null} />;
}
