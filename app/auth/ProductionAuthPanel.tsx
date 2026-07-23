import Link from "next/link";
import { FcGoogle } from "react-icons/fc";
import { HiOutlineEnvelope, HiOutlineShieldCheck } from "react-icons/hi2";
import { safeReturnTo } from "../../lib/server/supabase-auth";
import { AuthExperienceIntro } from "./AuthExperienceIntro";
import styles from "./AuthPage.module.css";

const MESSAGES: Record<string, string> = {
  callback_failed: "登入連結已失效或無法驗證，請重新登入。",
  email_unavailable: "目前無法寄出登入信，請稍後再試。",
  invalid_email: "請輸入有效的 Email。",
  rate_limited: "登入嘗試過於頻繁，請稍後再試。",
  unavailable: "正式登入尚未完成環境設定。",
};

export function ProductionAuthPanel({ returnTo, sent, error, ready }: {
  returnTo: string;
  sent?: string;
  error?: string;
  ready: boolean;
}) {
  const destination = safeReturnTo(returnTo, "/bots");
  return (
    <div className={styles.shell}>
      <AuthExperienceIntro />
      <section className={styles.card} aria-labelledby="auth-title">
        <div className={styles.cardIntro}>
          <p className={styles.kicker}>WELCOME BACK</p>
          <h1 id="auth-title">登入後繼續剛才的策略</h1>
          <p>使用 Google 或 Email Magic Link 建立會員工作區。登入只會保存策略與操作紀錄，不會連接 WEEX。</p>
        </div>
        {ready ? <>
          <Link className={styles.googleButton} href={`/auth/google?return_to=${encodeURIComponent(destination)}`}>
            <FcGoogle aria-hidden="true" />
            <span>使用 Google 繼續</span>
          </Link>
          <div className={styles.divider}><span>或使用 Email Magic Link</span></div>
          <form action="/auth/email" className={styles.form} method="post">
            <input name="return_to" type="hidden" value={destination} />
            <label htmlFor="auth-email">Email 地址</label>
            <div className={styles.inputWrap}>
              <HiOutlineEnvelope aria-hidden="true" />
              <input autoComplete="email" id="auth-email" maxLength={254} name="email" placeholder="you@example.com" required type="email" />
            </div>
            <button className={styles.emailButton} type="submit"><HiOutlineEnvelope aria-hidden="true" />寄送安全登入連結</button>
          </form>
        </> : <p className={styles.feedback} role="alert">正式登入尚未完成環境設定，所有會員寫入與交易功能已安全停用。</p>}
        {sent === "1" && <p className={styles.feedback} role="status">登入信已送出。請在 10 分鐘內使用同一瀏覽器開啟連結。</p>}
        {error && <p className={`${styles.feedback} ${styles.feedbackError}`} role="alert">{MESSAGES[error] ?? "登入未完成，請重新嘗試。"}</p>}
        <div className={styles.securityNote}>
          <HiOutlineShieldCheck aria-hidden="true" />
          <div><strong>登入不等於授權交易</strong><span>登入僅用於保存策略與操作紀錄，不會自動授權或執行任何交易。</span></div>
        </div>
        <div className={styles.cardFooter}>
          <p>繼續即表示你已閱讀 <Link href="/legal">使用條款、隱私與風險說明</Link>。</p>
          <Link href="/disclosures">風險與資料使用說明</Link>
        </div>
      </section>
    </div>
  );
}
