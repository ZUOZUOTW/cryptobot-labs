import Link from "next/link";

export default function NotFoundPage() {
  return (
    <div className="not-found-page site-container">
      <div className="empty-state glass-panel">
        <p className="eyebrow">PAGE NOT FOUND / 404</p>
        <h1>找不到這個頁面</h1>
        <p>你前往的頁面不存在、已移動，或連結不完整。可以回到首頁，或繼續探索適用 WEEX 的策略。</p>
        <div className="button-row">
          <Link className="button button--secondary" href="/">返回首頁</Link>
          <Link className="button button--primary" href="/bots">探索策略</Link>
        </div>
      </div>
    </div>
  );
}
