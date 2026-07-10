import type { Metadata } from "next";
import { SkeletonPreview } from "./_sites-preview/SkeletonPreview";

export const metadata: Metadata = {
  title: "CryptoBot Labs",
  description: "CryptoBot Labs 正在準備中，完成後將自動顯示。",
  other: {
    "codex-preview": "development",
  },
};

export default function Home() {
  return <SkeletonPreview />;
}
