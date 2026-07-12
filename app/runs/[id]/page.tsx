import Link from "next/link";
import { RunDetailPanel } from "../../../components/runs/RunDetailPanel";
import { requireChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

interface RunDetailPageProps { params: Promise<{ id: string }> }

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { id } = await params;
  const safeId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) ? id : "invalid";
  await requireChatGPTUser(`/runs/${encodeURIComponent(safeId)}`);
  return (
    <div className="run-detail-page site-container">
      <Link className="back-link" href="/runs"><span aria-hidden="true">←</span> 返回所有運行</Link>
      <RunDetailPanel runId={safeId} />
    </div>
  );
}
