import { demoModeEnabled } from "../../lib/server/demo-mode";
import { productionAuthReady, safeReturnTo } from "../../lib/server/supabase-auth";
import { DemoAuthPanel } from "./DemoAuthPanel";
import { ProductionAuthPanel } from "./ProductionAuthPanel";
import styles from "./AuthPage.module.css";

export const dynamic = "force-dynamic";

export default async function AuthPage({ searchParams }: {
  searchParams?: Promise<{ return_to?: string; sent?: string; error?: string }>;
}) {
  const query = await searchParams;
  return (
    <div className={styles.page}>
      {demoModeEnabled() ? <DemoAuthPanel /> : <ProductionAuthPanel ready={productionAuthReady()}
        returnTo={safeReturnTo(query?.return_to, "/bots")} sent={query?.sent} error={query?.error} />}
    </div>
  );
}
