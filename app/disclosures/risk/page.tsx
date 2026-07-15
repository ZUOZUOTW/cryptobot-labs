import Link from "next/link";

export const metadata = { title: "交易風險揭露｜CryptoBot Labs" };

export default function RiskDisclosurePage() {
  return <div className="legal-page site-container"><header className="page-intro"><p className="eyebrow">TRADING RISK DISCLOSURE</p><h1>交易風險揭露</h1><p>加密資產與衍生品交易具有高度風險，可能在短時間內損失全部投入資金。請只使用你能承受損失的資金。</p></header>
    <section className="glass-panel legal-copy"><h2>回測與模擬的限制</h2><p>回測與 Paper 結果受資料品質、取樣期間、手續費、滑價、資金費率、成交假設與過度擬合影響，不代表未來績效。模擬成交不能完整重現流動性不足、急速行情、拒單、部分成交或交易所中斷。</p>
      <h2>現貨與合約風險</h2><p>現貨價格可能劇烈波動且缺乏流動性。合約使用槓桿會放大損益，可能觸發強制平倉、穿倉機制、額外保證金需求與持續資金費率；損失速度可能快於人工介入。</p>
      <h2>自動化與技術風險</h2><p>網路延遲、WEEX API 變更、重複或延遲事件、時鐘偏差、資料錯誤、雲端或 KMS 故障均可能導致錯過交易、未知訂單狀態或策略停止。本站使用冪等鍵、訂單對帳、fenced lease、最大損失與曝險限制降低風險，但無法消除風險。</p>
      <h2>你的最低安全措施</h2><p>先以 Paper 模式觀察完整市場週期；將槓桿、單筆名目、總曝險與每日最大虧損設在可承受範圍；確認 WEEX API key 沒有提幣權限；定期檢查成交與持倉；保留直接登入 WEEX 撤銷 API key、取消掛單與平倉的能力。</p>
      <h2>實盤確認</h2><p>啟用實盤不代表本站認為策略適合你。每次重大策略或風控變更都應重新進行 Paper 驗收。若狀態不一致、無法確認權限或執行器失聯，系統應拒絕新單並要求人工處理。</p>
      <Link className="button button--primary" href="/connections">查看 WEEX 連線狀態</Link></section>
  </div>;
}
