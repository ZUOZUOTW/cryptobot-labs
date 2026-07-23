import Link from "next/link";

export default function OfflinePage() {
  return (
    <div className="offline-page site-container">
      <section className="glass-panel offline-card" aria-labelledby="offline-title">
        <p className="eyebrow">OFFLINE / READ ONLY</p>
        <h1 id="offline-title">目前沒有網路連線</h1>
        <p>
          為避免送出過期或重複的交易指令，離線狀態不會排程任何運行控制。恢復網路後再重新整理，即可取得最新狀態。
        </p>
        <div className="button-row">
          <Link className="button button--primary" href="/runs">重新查看運行</Link>
          <Link className="button button--secondary" href="/">返回首頁</Link>
        </div>
      </section>
    </div>
  );
}
