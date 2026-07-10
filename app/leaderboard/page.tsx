import { LeaderboardTable } from "../../components/LeaderboardTable";

export default function LeaderboardPage() {
  return (
    <div className="leaderboard-page site-container">
      <header className="page-intro leaderboard-page__intro">
        <p className="eyebrow">SIMULATED PERFORMANCE / WEEX ONLY</p>
        <h1>績效排行榜</h1>
        <p>切換模擬期間與評比方式，從收益、穩定度、回撤及風險調整後報酬比較 10 組官方策略。</p>
        <p className="simulation-disclosure" role="note">模擬回測資料，不代表未來績效</p>
      </header>
      <LeaderboardTable />
    </div>
  );
}
