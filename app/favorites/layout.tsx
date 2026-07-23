import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "收藏策略",
  description: "集中查看你收藏的策略，可直接查看詳細資料或帶入組裝車間。",
};

export default function FavoritesLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
