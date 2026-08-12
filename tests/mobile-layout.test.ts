import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const globals = readFileSync(resolve("app/globals.css"), "utf8");
const workshop = readFileSync(resolve("app/workshop.css"), "utf8");
const auth = readFileSync(resolve("app/auth/AuthPage.module.css"), "utf8");

describe("mobile layout safeguards", () => {
  it("does not impose a page-wide minimum width", () => {
    expect(globals).toMatch(/html\s*\{[\s\S]*?min-width:\s*0;/);
    expect(globals).toMatch(/\.site-main\s*\{[\s\S]*?min-width:\s*0;/);
  });

  it("keeps primary controls at least 44 CSS pixels tall", () => {
    expect(globals).toMatch(/button,[\s\S]*?input:not\(\[type="file"\]\),[\s\S]*?select\s*\{[\s\S]*?min-block-size:\s*2\.75rem;/);
    expect(globals).toMatch(/\.mobile-tab-bar a\s*\{[\s\S]*?min-height:\s*3\.45rem;/);
  });

  it("lets homepage media shrink to the mobile content column", () => {
    expect(globals).toMatch(
      /@media \(max-width: 52rem\)[\s\S]*?\.strategy-assembly-player,[\s\S]*?\.strategy-code-player\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%;[\s\S]*?min-height:\s*0;/,
    );
  });

  it("stacks the workshop toolbar without squeezing labels vertically", () => {
    expect(workshop).toMatch(
      /@media \(max-width: 44rem\)[\s\S]*?\.workshop-mode\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
    );
    expect(workshop).toMatch(
      /@media \(max-width: 44rem\)[\s\S]*?\.workshop-toolbar\s*\{[\s\S]*?flex-direction:\s*column;/,
    );
    expect(workshop).toMatch(/\.workshop-mode \.workshop-clear\s*\{[\s\S]*?grid-column:\s*1 \/ -1;/);
    expect(workshop).toMatch(/\.workshop-clear\s*\{[\s\S]*?min-height:\s*2\.75rem;/);
  });

  it("reserves vertical scrolling while enabling workshop swipe navigation", () => {
    expect(workshop).toMatch(/\.workshop-grid\s*\{[\s\S]*?touch-action:\s*pan-y;/);
    expect(workshop).toMatch(/\.workshop-swipe-hint\s*\{[\s\S]*?display:\s*block;/);
  });

  it("keeps the secondary auth link touch-friendly", () => {
    expect(auth).toMatch(/\.cardFooter > a\s*\{[\s\S]*?min-height:\s*2\.75rem;/);
  });

  it("allows longer translated tab labels to wrap instead of truncating", () => {
    expect(globals).toMatch(
      /html:is\(\[data-locale="en"\],[\s\S]*?\.mobile-tab-bar span\s*\{[\s\S]*?overflow-wrap:\s*normal;[\s\S]*?white-space:\s*normal;[\s\S]*?word-break:\s*normal;/,
    );
  });

  it("keeps short discovery labels on word boundaries and stacks the 390px summary", () => {
    expect(globals).toMatch(/\.catalog-summary, \.catalog-summary \*, \.catalog-favorites-link span\)\s*\{[\s\S]*?overflow-wrap:\s*normal;[\s\S]*?word-break:\s*normal;/);
    expect(globals).toMatch(/@media \(max-width: 38rem\)[\s\S]*?\.catalog-summary\s*\{[\s\S]*?flex-direction:\s*column;/);
  });

  it("lets control-center card values and empty risk text wrap at small widths", () => {
    expect(workshop).toMatch(/@media \(max-width: 42rem\)[\s\S]*?\.control-center-table-shell tbody td\s*\{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?white-space:\s*normal;/);
    expect(workshop).toMatch(/\.control-center-table-shell tbody td \.risk-usage-empty\s*\{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?white-space:\s*normal;/);
  });
});
