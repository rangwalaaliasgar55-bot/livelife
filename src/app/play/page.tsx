"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

function PlayInner() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("life");
  useEffect(() => {
    if (!id) router.replace("/");
  }, [id, router]);
  if (!id) return <main className="grid min-h-screen place-items-center"><p className="tick">Loading…</p></main>;
  return <PlayId id={id} />;
}

import { GameApp } from "@/components/game/GameApp";

function PlayId({ id }: { id: string }) {
  return <GameApp id={id} />;
}

export default function PlayPage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center"><p className="tick">Opening the world…</p></main>}>
      <PlayInner />
    </Suspense>
  );
}
