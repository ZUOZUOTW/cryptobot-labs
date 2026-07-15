import Link from "next/link";
import { RunDetailPanel } from "../../../components/runs/RunDetailPanel";
import { DemoRunDetail } from "../../../components/runs/DemoRunDetail";
import { demoModeEnabled } from "../../../lib/server/demo-mode";

export const dynamic = "force-dynamic";

interface RunDetailPageProps { params: Promise<{ id: string }> }

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { id } = await params;
  const safeId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) ? id : "invalid";
  return (
    <div className="run-detail-page site-container">
      <Link className="back-link" href="/runs"><span aria-hidden="true">←</span> 返回所有運行</Link>
      {demoModeEnabled() && safeId.startsWith("demo-") ? <DemoRunDetail runId={safeId} /> : <RunDetailPanel runId={safeId} />}
    </div>
  );
}
