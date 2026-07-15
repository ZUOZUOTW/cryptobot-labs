import { notFound } from "next/navigation";
import { demoModeEnabled } from "../../../lib/server/demo-mode";
import { DemoAuthorizePanel } from "./DemoAuthorizePanel";

export default function DemoWeexAuthorizePage() {
  if (!demoModeEnabled()) notFound();
  return <div className="demo-authorize-page site-container"><DemoAuthorizePanel /></div>;
}
