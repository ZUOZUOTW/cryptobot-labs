// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("cloud order evidence mobile layout", () => {
  it("uses responsive cards, a one-column narrow layout, and a 44px recovery target", async () => {
    const [styles, component] = await Promise.all([
      readFile("app/globals.css", "utf8"),
      readFile("components/runs/CloudOrderEvidence.tsx", "utf8"),
    ]);

    expect(component).toContain('className="run-order-card glass-panel"');
    expect(component).not.toContain("<table");
    expect(styles).toMatch(/\.run-orders__list\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
    expect(styles).toMatch(/@media \(max-width: 62rem\)[\s\S]*?\.run-orders__list\s*\{\s*grid-template-columns:\s*1fr;/);
    expect(styles).toMatch(/@media \(max-width: 24rem\)[\s\S]*?\.run-order-card__facts\s*\{\s*grid-template-columns:\s*1fr;/);
    expect(styles).toMatch(/\.run-orders__retry\s*\{\s*min-height:\s*2\.75rem;/);
  });
});
