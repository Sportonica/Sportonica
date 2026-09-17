import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getConversationPeer, getConversationMessages } from "@/lib/dm/queries";
import { haveIBlocked } from "@/lib/blocking/queries";
import DMThread from "./DMThread";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: { params: Promise<{ conversationId: string }> }): Promise<Metadata> {
  const { conversationId } = await params;
  const info = await getConversationPeer(conversationId);
  const name = info?.peer.full_name ?? info?.peer.username;
  return { title: name ? `${name} — Sportonica` : "Messages — Sportonica" };
}

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const info = await getConversationPeer(conversationId);
  if (!info) notFound();

  const [messages, blocked] = await Promise.all([
    getConversationMessages(conversationId),
    haveIBlocked(info.peer.id),
  ]);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px 40px" }}>
      <DMThread
        conversationId={conversationId}
        meId={info.meId}
        peer={info.peer}
        initialMessages={messages}
        initialBlocked={blocked}
      />
    </div>
  );
}
