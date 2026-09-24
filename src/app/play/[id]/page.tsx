import { GameApp } from "@/components/game/GameApp";

export const dynamic = "force-dynamic";

export default async function PlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GameApp id={id} />;
}
