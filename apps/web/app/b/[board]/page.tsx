import { notFound } from "next/navigation";
import { BoardClient } from "@/components/BoardClient";

export default async function BoardPage({ params }: { params: Promise<{ board: string }> }) {
  const { board } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(board)) notFound();
  return <BoardClient boardId={board} />;
}
