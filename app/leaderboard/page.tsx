import { LeaderboardTable } from "../../components/LeaderboardTable";

export default function LeaderboardPage() {
  return (
    <div className="leaderboard-page site-container">
      <header className="page-intro leaderboard-page__intro">
        <p className="eyebrow">ORBITAL BOT LEAGUE / WEEX API · SEASON 01</p>
        <h1>策略競技排行榜</h1>
        <p>進入策略競技場，依收益、穩定度、回撤及風險調整後報酬，追蹤 10 組官方策略的近期排名。</p>
      </header>
      <LeaderboardTable />
    </div>
  );
}
