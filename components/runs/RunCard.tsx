import Link from "next/link";
import { MODE_LABEL, type RunView } from "./types";

const STATE_LABEL = { stopped: "已停止", running: "運行中", paused: "已暫停", error: "需要處理" } as const;
const HEALTH_LABEL = { healthy: "正常", degraded: "異常", paused: "暫停", unknown: "尚無代理證據" } as const;
const evidenceTime = (value: number) => new Intl.DateTimeFormat("zh-TW", { dateStyle: "short", timeStyle: "short" }).format(value);

export function RunCard({ run }: { run: RunView }) {
  return (
    <article className="run-card glass-panel">
      <header className="run-card__header">
        <div><p className="eyebrow">RUN / {run.id}</p><h2>{run.botName}</h2></div>
        <span className="run-mode" data-mode={run.mode}>{run.market === "spot" ? "現貨" : "合約"} · {MODE_LABEL[run.mode]}</span>
      </header>
      <dl className="run-facts">
        <div><dt>狀態</dt><dd>{STATE_LABEL[run.state]}</dd></div>
        <div><dt>代理健康</dt><dd>{HEALTH_LABEL[run.health ?? "unknown"]}</dd></div>
        <div><dt>損益</dt><dd>{run.pnl === null ? "尚無可信證據" : `${Number(run.pnl) >= 0 ? "+" : ""}${run.pnl} USDT`}</dd></div>
        <div><dt>部位 / 掛單</dt><dd>{run.positions.length} / {run.openOrders.length}</dd></div>
      </dl>
      <div className="run-card__evidence">
        <p><strong>心跳來源</strong>{run.evidence.heartbeatOccurredAt === null ? "尚未收到目前版本心跳" : `版本 ${run.evidence.heartbeatExpectedDeploymentVersion} · ${evidenceTime(run.evidence.heartbeatOccurredAt)}`}</p>
        <p><strong>最後訊號</strong>{run.lastSignal ? `${run.lastSignal.action} · ${run.lastSignal.reason} · ${evidenceTime(run.lastSignal.occurredAt)}` : "尚未收到訊號"}</p>
        <p><strong>風險攔截</strong>{run.riskBlocks.length ? `${run.riskBlocks.length} 筆` : "目前無紀錄"}</p>
      </div>
      <footer><time dateTime={new Date(run.updatedAt).toISOString()}>更新於 {new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(run.updatedAt)}</time><Link className="button button--secondary button--small" href={`/runs/${encodeURIComponent(run.id)}`}>查看控制中心</Link></footer>
    </article>
  );
}
