import { demoModeEnabled } from "../lib/server/demo-mode";

export function DemoModeBanner() {
  if (!demoModeEnabled()) return null;
  return (
    <aside className="demo-mode-banner" role="status">
      <strong>展示模式</strong><span>不會連接交易所或送出真實訂單</span>
    </aside>
  );
}
