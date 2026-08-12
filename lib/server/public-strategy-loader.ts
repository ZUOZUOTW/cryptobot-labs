import { unstable_cache } from "next/cache";
import { createControlPlaneDatabase } from "@/db";
import { createStrategyPublicationRepository } from "@/db/repositories";
import { env } from "@/lib/server/platform-env";
import {
  InvalidPublicStrategyTrustMetadataError,
  PUBLIC_STRATEGY_CACHE_VERSION,
  parseWeexReferralUrl,
  publicStrategyPublicationCacheTag,
  toPublicStrategyPublication,
} from "@/lib/server/strategy-publications";
import type { PublicStrategyPublication } from "@/lib/strategy-publications";

const loadCachedPublication = (slug: string) => unstable_cache(
  async (): Promise<PublicStrategyPublication | null> => {
    const database = createControlPlaneDatabase(env.DB);
    const record = await createStrategyPublicationRepository(database).getBySlug(slug);
    if (!record) return null;
    try {
      return { ...toPublicStrategyPublication(record), weexReferralUrl: null };
    } catch (error) {
      console.error("[strategy-publication] invalid public record", {
        slug,
        name: error instanceof Error ? error.name : "Error",
      });
      if (error instanceof InvalidPublicStrategyTrustMetadataError) return null;
      throw error;
    }
  },
  ["public-strategy-publication", PUBLIC_STRATEGY_CACHE_VERSION, slug],
  { revalidate: 3600, tags: [publicStrategyPublicationCacheTag(slug)] },
)();

const PUBLIC_STRATEGY_SLUG = /^[a-z0-9][a-z0-9-]{7,79}$/;

export const loadPublicStrategyPublication = async (slug: string): Promise<PublicStrategyPublication | null> => {
  if (!PUBLIC_STRATEGY_SLUG.test(slug)) return Promise.resolve(null);
  const publication = await loadCachedPublication(slug);
  if (!publication) return null;
  const database = createControlPlaneDatabase(env.DB);
  const currentReferralUrl = await createStrategyPublicationRepository(database)
    .getApprovedReferralUrlBySlug(slug);
  if (!currentReferralUrl) return publication;
  try {
    return { ...publication, weexReferralUrl: parseWeexReferralUrl(currentReferralUrl) };
  } catch {
    console.error("[strategy-publication] invalid approved referral URL", { slug });
    return publication;
  }
};
