import type { ControlPlaneDatabase } from "../index";
import { displayName, exactInput, id, time } from "./shared";
import {
  validatePublicPublicationDescription,
  validatePublicPublisherName,
} from "../../lib/publication-moderation";

const SLUG = /^[a-z0-9][a-z0-9-]{7,79}$/;

export interface StrategyPublicationRecord {
  id: string;
  userId: string;
  strategyVersionId: string;
  backtestJobId: string;
  slug: string;
  name: string;
  description: string;
  publisherName: string;
  weexReferralUrl: string | null;
  market: "spot" | "futures";
  symbol: string;
  configJson: string;
  metricsJson: string;
  equityCurveJson: string;
  actualStartAt: number | null;
  actualEndAt: number | null;
  publishedAt: number;
  updatedAt: number;
}

export interface StrategyPublicationCursor {
  publishedAt: number;
  id: string;
}

const projection = `p.id,p.user_id AS userId,p.strategy_version_id AS strategyVersionId,
  p.backtest_job_id AS backtestJobId,p.slug,s.name,p.description,p.publisher_name AS publisherName,
  CASE WHEN p.weex_referral_url IS NOT NULL THEN promoter.weex_referral_url ELSE NULL END AS weexReferralUrl,
  s.market,s.symbol,v.config_json AS configJson,
  r.metrics_json AS metricsJson,r.equity_curve_json AS equityCurveJson,
  d.actual_start_at AS actualStartAt,d.actual_end_at AS actualEndAt,
  p.published_at AS publishedAt,p.updated_at AS updatedAt`;

const publishedJoin = `FROM strategy_publications p
  LEFT JOIN promoters promoter ON promoter.user_id=p.user_id
    AND promoter.status='active' AND promoter.role IN ('kol','bd')
    AND promoter.weex_referral_url IS NOT NULL AND promoter.approved_at IS NOT NULL
  JOIN strategy_versions v ON v.id=p.strategy_version_id AND v.user_id=p.user_id
  JOIN strategies s ON s.id=v.strategy_id AND s.user_id=v.user_id
  JOIN backtest_jobs j ON j.id=p.backtest_job_id AND j.user_id=p.user_id
    AND j.strategy_version_id=v.id AND j.status='succeeded' AND j.evidence_level='historical'
  JOIN backtest_results r ON r.backtest_job_id=j.id AND r.user_id=j.user_id
    AND r.evidence_level='historical' AND r.configuration_hash=v.config_hash
  JOIN backtest_datasets d ON d.backtest_job_id=j.id AND d.user_id=j.user_id
    AND d.id=r.dataset_id AND d.complete=1`;

export function createStrategyPublicationRepository(database: ControlPlaneDatabase) {
  const listPage = async (options: {
    limit: number;
    cursor?: StrategyPublicationCursor;
  }): Promise<{
    items: StrategyPublicationRecord[];
    nextCursor: StrategyPublicationCursor | null;
  }> => {
    exactInput(options, ["limit", "cursor"]);
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100) {
      throw new Error("publication limit is invalid");
    }
    const cursor = options.cursor;
    if (cursor !== undefined) exactInput(cursor, ["publishedAt", "id"]);
    const result = cursor === undefined
      ? await database.prepare(`SELECT ${projection} ${publishedJoin}
          ORDER BY p.published_at DESC,p.id DESC LIMIT ?`)
        .bind(options.limit + 1).all<StrategyPublicationRecord>()
      : await database.prepare(`SELECT ${projection} ${publishedJoin}
          WHERE (p.published_at < ? OR (p.published_at = ? AND p.id < ?))
          ORDER BY p.published_at DESC,p.id DESC LIMIT ?`)
        .bind(time(cursor.publishedAt, "cursor.publishedAt"), time(cursor.publishedAt, "cursor.publishedAt"),
          id(cursor.id, "cursor.id"), options.limit + 1).all<StrategyPublicationRecord>();
    if (!result.success) throw new Error("publication list failed");
    const hasMore = result.results.length > options.limit;
    const items = result.results.slice(0, options.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? { publishedAt: last.publishedAt, id: last.id } : null,
    };
  };

  return {
    async hasApprovedReferral(userId: string): Promise<boolean> {
      const owner = id(userId, "userId");
      const record = await database.prepare(`SELECT user_id FROM promoters
        WHERE user_id=? AND status='active' AND role IN ('kol','bd')
          AND weex_referral_url IS NOT NULL AND approved_at IS NOT NULL
        LIMIT 1`).bind(owner).first<{ userId: string }>();
      return record !== null;
    },

    async getApprovedReferralUrlBySlug(slug: string): Promise<string | null> {
      if (!SLUG.test(slug)) return null;
      const record = await database.prepare(`SELECT promoter.weex_referral_url AS weexReferralUrl
        FROM strategy_publications p
        JOIN promoters promoter ON promoter.user_id=p.user_id
          AND promoter.status='active' AND promoter.role IN ('kol','bd')
          AND promoter.weex_referral_url IS NOT NULL AND promoter.approved_at IS NOT NULL
        WHERE p.slug=? AND p.weex_referral_url IS NOT NULL
        LIMIT 1`).bind(slug).first<{ weexReferralUrl: string }>();
      return record?.weexReferralUrl ?? null;
    },

    async publish(input: {
      id: string;
      userId: string;
      strategyVersionId: string;
      backtestJobId: string;
      slug: string;
      description: string;
      publisherName: string;
      now: number;
    }): Promise<StrategyPublicationRecord | null> {
      exactInput(input, ["id", "userId", "strategyVersionId", "backtestJobId", "slug", "description",
        "publisherName", "now"]);
      const publicationId = id(input.id, "publicationId");
      const owner = id(input.userId, "userId");
      const versionId = id(input.strategyVersionId, "strategyVersionId");
      const jobId = id(input.backtestJobId, "backtestJobId");
      const publisher = validatePublicPublisherName(displayName(input.publisherName, "publisherName"));
      const now = time(input.now, "now");
      if (!SLUG.test(input.slug)) throw new Error("publication slug is invalid");
      const description = validatePublicPublicationDescription(input.description);
      if (!publisher.valid) throw new Error("publication publisher is invalid");
      if (!description.valid) {
        throw new Error("publication description is invalid");
      }
      return database.prepare(`INSERT INTO strategy_publications
        (id,user_id,strategy_version_id,backtest_job_id,slug,description,publisher_name,weex_referral_url,
          published_at,updated_at)
        SELECT ?,v.user_id,v.id,j.id,?,?,?,?,?,?
        FROM strategy_versions v
        JOIN backtest_jobs j ON j.user_id=v.user_id AND j.strategy_version_id=v.id
          AND j.id=? AND j.status='succeeded' AND j.evidence_level='historical'
        JOIN backtest_results r ON r.user_id=j.user_id AND r.backtest_job_id=j.id
          AND r.evidence_level='historical' AND r.configuration_hash=v.config_hash
        JOIN backtest_datasets d ON d.user_id=j.user_id AND d.backtest_job_id=j.id
          AND d.id=r.dataset_id AND d.complete=1
        WHERE v.user_id=? AND v.id=?
        ON CONFLICT(strategy_version_id) DO UPDATE SET
          backtest_job_id=excluded.backtest_job_id,
          description=excluded.description,
          publisher_name=excluded.publisher_name,
          updated_at=excluded.updated_at
        WHERE strategy_publications.user_id=excluded.user_id
        RETURNING id,user_id AS userId,strategy_version_id AS strategyVersionId,
          backtest_job_id AS backtestJobId,slug,'' AS name,description,publisher_name AS publisherName,
          weex_referral_url AS weexReferralUrl,'' AS market,'' AS symbol,'' AS configJson,
          '' AS metricsJson,'' AS equityCurveJson,NULL AS actualStartAt,NULL AS actualEndAt,
          published_at AS publishedAt,updated_at AS updatedAt`)
        .bind(publicationId, input.slug, description.value, publisher.value, null, now, now,
          jobId, owner, versionId).first<StrategyPublicationRecord>();
    },

    async activateApprovedReferral(input: {
      userId: string;
      slug: string;
      now: number;
    }): Promise<boolean> {
      exactInput(input, ["userId", "slug", "now"]);
      const owner = id(input.userId, "userId");
      const now = time(input.now, "now");
      if (!SLUG.test(input.slug)) return false;
      const updated = await database.prepare(`UPDATE strategy_publications
        SET weex_referral_url=(
          SELECT approved.weex_referral_url FROM promoters approved
          WHERE approved.user_id=? AND approved.status='active'
            AND approved.role IN ('kol','bd') AND approved.weex_referral_url IS NOT NULL
            AND approved.approved_at IS NOT NULL
          LIMIT 1
        ),updated_at=?
        WHERE user_id=? AND slug=?
          AND EXISTS (
            SELECT 1 FROM promoters approved
            WHERE approved.user_id=? AND approved.status='active'
              AND approved.role IN ('kol','bd') AND approved.weex_referral_url IS NOT NULL
              AND approved.approved_at IS NOT NULL
          )
        RETURNING slug`)
        .bind(owner, now, owner, input.slug, owner).first<{ slug: string }>();
      return updated !== null;
    },

    getBySlug(slug: string): Promise<StrategyPublicationRecord | null> {
      if (!SLUG.test(slug)) return Promise.resolve(null);
      return database.prepare(`SELECT ${projection} ${publishedJoin}
        WHERE p.slug=? LIMIT 1`).bind(slug).first<StrategyPublicationRecord>();
    },

    async list(limit = 24): Promise<StrategyPublicationRecord[]> {
      return (await listPage({ limit })).items;
    },

    listPage,

    async listByUser(userId: string, limit = 100): Promise<StrategyPublicationRecord[]> {
      const owner = id(userId, "userId");
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("publication limit is invalid");
      const result = await database.prepare(`SELECT ${projection} ${publishedJoin}
        WHERE p.user_id=?
        ORDER BY p.published_at DESC,p.id DESC LIMIT ?`).bind(owner, limit).all<StrategyPublicationRecord>();
      return result.results;
    },
  };
}
