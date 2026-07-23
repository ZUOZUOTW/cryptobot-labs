import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "CryptoBot Labs",
    short_name: "CryptoBot",
    description: "探索、組裝、回測與監控自動交易策略。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#06070b",
    theme_color: "#06070b",
    orientation: "portrait-primary",
    categories: ["finance", "productivity", "utilities"],
    icons: [
      {
        src: "/icons/cryptobot-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/cryptobot-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/cryptobot-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "探索策略", short_name: "探索", url: "/bots" },
      { name: "組裝策略", short_name: "組裝", url: "/workshop" },
      { name: "我的運行", short_name: "運行", url: "/runs" },
    ],
  };
}
