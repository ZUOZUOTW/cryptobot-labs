import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { SiteHeader } from "../components/SiteHeader";

afterEach(cleanup);

describe("SiteHeader", () => {
  it.each([
    ["機器人", "/bots"],
    ["排行榜", "/leaderboard"],
    ["組裝車間", "/workshop"],
    ["連線", "/connections"],
    ["運行", "/runs"],
  ])("links %s to %s", (name, href) => {
    render(<SiteHeader />);

    const links = screen.getAllByRole("link", { name });
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => link.getAttribute("href") === href)).toBe(true);
  });

  it("toggles the accessible mobile navigation region", async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);

    const button = screen.getByRole("button", { name: "開啟導覽選單" });
    const navigation = document.getElementById("mobile-navigation");

    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(navigation).toHaveAttribute("aria-label", "行動版導覽");
    expect(navigation).toHaveAttribute("hidden");

    await user.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAccessibleName("關閉導覽選單");
    expect(navigation).not.toHaveAttribute("hidden");
    expect(screen.getByRole("navigation", { name: "行動版導覽" })).toBe(navigation);
  });
});
