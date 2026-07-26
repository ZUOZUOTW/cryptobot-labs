import { unstable_cache } from "next/cache";
import { createControlPlaneDatabase } from "@/db";
import { createStrategyPublicationRepository } from "@/db/repositories";
import { env } from "@/lib/server/platform-env";
import { toPublicStrategyPublication } from "@/lib/server/strategy-publications";
import type { PublicStrategyPublication } from "@/lib/strategy-publications";

const loadCachedPublication = unstable_cache(
  async (slug: string): Promise<PublicStrategyPublication | null> => {
    const database = createControlPlaneDatabase(env.DB);
    const record = await createStrategyPublicationRepository(database).getBySlug(slug);
    if (!record) return null;
    try {
      return toPublicStrategyPublication(record);
    } catch (error) {
      console.error("[strategy-publication] invalid public record", {
        slug,
        name: error instanceof Error ? error.name : "Error",
      });
      return null;
    }
  },
  ["public-strategy-publication"],
  { revalidate: 3600 },
);

export const loadPublicStrategyPublication = (slug: string): Promise<PublicStrategyPublication | null> => (
  loadCachedPublication(slug)
);
