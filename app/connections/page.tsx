import Link from "next/link";
import { AgentDownloadCard } from "../../components/connections/AgentDownloadCard";
import { ConnectionsPanel } from "../../components/connections/ConnectionsPanel";
import { PairingCodeCard } from "../../components/connections/PairingCodeCard";
import { requireChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const user = await requireChatGPTUser("/connections");
  return (
    <div className="connections-page site-container">
      <header className="page-intro connections-page__intro">
        <p className="eyebrow">LOCAL-FIRST CONNECTIONS</p>
        <h1>安全連結<br />本機交易代理</h1>
        <p>{user.displayName}，交易所憑證只會輸入並保存在你的電腦。CryptoBot Labs 網站只顯示遮罩後的連線證據與權限摘要。</p>
        <div className="button-row"><Link className="button button--ghost" href="/workshop">返回組裝車間</Link><a className="button button--ghost" href="/signout-with-chatgpt?return_to=%2F">登出</a></div>
        <p className="connection-safety" role="note"><strong>重要：</strong>請勿在此網站或任何對話中貼上 API Key、API Secret 或 Passphrase。建議使用 WEEX API，並關閉提領權限。</p>
      </header>
      <div className="connections-setup"><AgentDownloadCard /><PairingCodeCard /></div>
      <ConnectionsPanel />
    </div>
  );
}
