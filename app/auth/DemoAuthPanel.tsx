"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { FcGoogle } from "react-icons/fc";
import { HiOutlineEnvelope, HiOutlineShieldCheck } from "react-icons/hi2";
import { safeReturnTo, signInDemo } from "../../lib/demo-auth";
import { AuthExperienceIntro } from "./AuthExperienceIntro";
import styles from "./AuthPage.module.css";

const destination = () => safeReturnTo(new URLSearchParams(window.location.search).get("return_to"), "/bots");

export function DemoAuthPanel() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const emailInput = useRef<HTMLInputElement>(null);
  const complete = (provider: "google" | "email", address: string, name: string) => {
    signInDemo({ provider, email: address, displayName: name });
    window.location.assign(destination());
  };
  const emailLogin = (event: FormEvent) => {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setMessage("請輸入有效的 Email。");
      emailInput.current?.focus();
      return;
    }
    setMessage("展示模式已驗證一次性連結，正在返回原頁面…");
    complete("email", normalized, normalized.split("@")[0] || "策略使用者");
  };
  return (
    <div className={styles.shell}>
      <AuthExperienceIntro demo />
      <section className={styles.card} aria-labelledby="auth-title">
        <div className={styles.cardIntro}>
          <p className={styles.kicker}>WELCOME BACK</p>
          <h1 id="auth-title">登入後繼續剛才的策略</h1>
          <p>使用 Google 或 Email 進入展示工作區；不會建立正式帳號、連接交易所或送出真實訂單。</p>
        </div>
        <button className={styles.googleButton} onClick={() => complete("google", "demo.google@example.test", "Google 展示用戶")} type="button">
          <FcGoogle aria-hidden="true" /><span>使用 Google 繼續</span>
        </button>
        <div className={styles.divider}><span>或使用 Email Magic Link</span></div>
        <form className={styles.form} onSubmit={emailLogin}>
          <label htmlFor="auth-email">Email 地址</label>
          <div className={styles.inputWrap}>
            <HiOutlineEnvelope aria-hidden="true" />
            <input aria-describedby={message ? "auth-email-feedback" : undefined} aria-invalid={message.startsWith("請") || undefined} autoComplete="email" id="auth-email" onChange={(event) => { setEmail(event.target.value); setMessage(""); }} placeholder="you@example.com" ref={emailInput} type="email" value={email} />
          </div>
          <button className={styles.emailButton} type="submit"><HiOutlineEnvelope aria-hidden="true" />使用 Email 繼續</button>
        </form>
        {message && <p className={`${styles.feedback} ${message.startsWith("請") ? styles.feedbackError : ""}`} id="auth-email-feedback" role={message.startsWith("請") ? "alert" : "status"}>{message}</p>}
        <div className={styles.securityNote}>
          <HiOutlineShieldCheck aria-hidden="true" />
          <div><strong>登入不等於授權交易</strong><span>展示登入只保存本機進度，不會連接交易所或送出任何訂單。</span></div>
        </div>
        <div className={styles.cardFooter}>
          <p>展示模式不會建立正式帳號，也不會連接交易所。</p>
          <Link href="/bots">先逛逛策略庫</Link>
        </div>
      </section>
    </div>
  );
}
