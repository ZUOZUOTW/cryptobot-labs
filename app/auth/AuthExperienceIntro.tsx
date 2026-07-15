import Image from "next/image";
import {
  HiOutlineArrowPathRoundedSquare,
  HiOutlineBookmarkSquare,
  HiOutlineLockClosed,
} from "react-icons/hi2";
import styles from "./AuthPage.module.css";

export function AuthExperienceIntro({ demo = false }: { demo?: boolean }) {
  return (
    <aside className={styles.experience} aria-label="登入後可使用的功能">
      <div className={styles.experienceIntro}>
        <p className={styles.kicker}>ORBITAL TRUST</p>
        <h2>安全進入你的<br />策略工作區</h2>
        <p>{demo ? "先以展示帳號體驗完整工作流，不需提供交易所憑證。" : "你的策略、參數與回測紀錄會保留；登入後接續剛才的進度。"}</p>
      </div>
      <div className={styles.mascotStage}>
        <span className={styles.status}>SECURE ACCESS</span>
        <Image
          alt="CryptoBot 安全守護機器人"
          height="420"
          priority
          src="/mascots/ai-guardian.png"
          unoptimized
          width="420"
        />
      </div>
      <ul className={styles.benefits}>
        <li><span><HiOutlineBookmarkSquare aria-hidden="true" /></span><div><strong>保存策略</strong><small>保留積木、參數與程式碼</small></div></li>
        <li><span><HiOutlineArrowPathRoundedSquare aria-hidden="true" /></span><div><strong>延續工作流</strong><small>回到剛才瀏覽或組裝的位置</small></div></li>
        <li><span><HiOutlineLockClosed aria-hidden="true" /></span><div><strong>權限分離</strong><small>登入不等於開啟真實交易</small></div></li>
      </ul>
    </aside>
  );
}
