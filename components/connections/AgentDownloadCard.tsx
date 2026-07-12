const AGENTS = [
  { platform: "macOS", detail: "Apple Silicon / Intel" },
  { platform: "Windows", detail: "Windows 11 / 10（64 位元）" },
] as const;

export function AgentDownloadCard() {
  return (
    <section className="connection-card connection-card--download" aria-labelledby="agent-download-title">
      <div className="connection-card__heading">
        <div><p className="eyebrow">LOCAL EXECUTION AGENT</p><h2 id="agent-download-title">安裝本機代理</h2></div>
        <span className="connection-pill connection-pill--preview">內部預覽</span>
      </div>
      <p className="connection-card__copy">
        本機代理負責保存 WEEX API 憑證及執行交易。網站不接收、傳送或保存 API Secret。
      </p>
      <div className="agent-build-grid">
        {AGENTS.map(({ platform, detail }) => (
          <article className="agent-build" key={platform}>
            <span className="agent-build__mark" aria-hidden="true">{platform === "macOS" ? "⌘" : "⊞"}</span>
            <div><h3>{platform}</h3><p>{detail}</p><small>Task 16 尚未提供簽署安裝檔</small></div>
            <button className="button button--ghost button--small" disabled type="button" aria-label={`${platform} 尚未提供下載`}>
              尚未提供下載
            </button>
          </article>
        ))}
      </div>
      <p className="connection-note" role="note">安裝檔完成簽署與安全驗證前，不會提供臨時或假下載連結。</p>
    </section>
  );
}
