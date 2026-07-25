import Link from "next/link";
import { CloudStrategyLauncher, type CloudAutomationTemplate } from "../../../components/runs/CloudStrategyLauncher";
import { BOT_CATALOG } from "../../../data/bots";
import { demoModeEnabled } from "../../../lib/server/demo-mode";

export const dynamic = "force-dynamic";

export default function NewRunPage() {
  const demoMode = demoModeEnabled();
  const templates: CloudAutomationTemplate[] = BOT_CATALOG
    .sort((left, right) => left.leverage - right.leverage || right.metrics.stability - left.metrics.stability)
    .map((bot) => ({
      config: {
        id: bot.id,
        name: bot.name,
        exchange: bot.exchange,
        market: bot.market,
        symbol: bot.symbol,
        timeframe: bot.timeframe,
        logicMode: bot.logicMode,
        leverage: bot.leverage,
        blocks: bot.blocks,
      },
      description: bot.description,
      riskNote: bot.riskNote,
      tags: bot.tags,
    }));

  return <div className="runs-page runs-page--task site-container">
    <Link className="back-link" href="/runs"><span aria-hidden="true">←</span> 返回控制中心</Link>
    <header className="run-task-heading">
      <div><p className="eyebrow">NEW AUTOMATION</p><h1>啟動新策略</h1>
        <p>依序確認策略、WEEX 權限、歷史回測與風控上限，完成後回到控制中心監看。</p></div>
      <span>USDT 真倉</span>
    </header>
    {demoMode ? <section className="runs-empty glass-panel"><h2>展示模式不啟動真倉策略</h2>
      <p>你仍可在組裝車間建立與測試模擬策略。</p>
      <Link className="button button--primary" href="/workshop">前往組裝策略</Link></section>
      : <CloudStrategyLauncher authReturnTo="/runs/new" templates={templates} />}
  </div>;
}
