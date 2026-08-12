import type { ControlPlaneDatabase } from "../index";
import { displayName, exactInput, id, time } from "./shared";
import {
  validatePublicPublicationDescription,
  validatePublicPublisherName,
} from "../../lib/publication-moderation";
import {
  hasFormalBacktestEvidence,
  type FormalEvidenceGateRow,
} from "../../lib/server/formal-evidence-gate";
import type { StrategyDiscoverySort } from "../../lib/strategy-discovery-query";
import type { Market, RiskLevel } from "../../lib/types";

const SLUG = /^[a-z0-9][a-z0-9-]{7,79}$/;

export interface StrategyPublicationRecord extends Partial<FormalEvidenceGateRow> {
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
  discoveryMarket?: Market;
  discoveryTimeframe?: string;
  discoveryRisk?: RiskLevel;
  discoveryTotalReturn?: number;
  discoveryMaxDrawdown?: number;
  discoveryWinRate?: number;
  discoveryStability?: number;
  discoveryRecommended?: number;
  publishedAt: number;
  updatedAt: number;
}

export interface StrategyPublicationCursor {
  publishedAt: number;
  id: string;
  sortValue?: number;
  sort?: StrategyDiscoverySort;
}

export interface StrategyPublicationListOptions {
  limit: number;
  cursor?: StrategyPublicationCursor;
  search?: string;
  market?: Market;
  timeframe?: string;
  risk?: RiskLevel;
  sort?: StrategyDiscoverySort | "latest";
  slugs?: string[];
}

const projection = `p.id,p.user_id AS userId,p.strategy_version_id AS strategyVersionId,
  p.backtest_job_id AS backtestJobId,p.slug,s.name,p.description,p.publisher_name AS publisherName,
  CASE WHEN p.weex_referral_url IS NOT NULL THEN promoter.weex_referral_url ELSE NULL END AS weexReferralUrl,
  s.market,s.symbol,v.config_json AS configJson,
  r.metrics_json AS metricsJson,r.equity_curve_json AS equityCurveJson,
  d.actual_start_at AS actualStartAt,d.actual_end_at AS actualEndAt,
  v.config_hash AS configHash,v.source_hash AS sourceHash,v.source_code AS sourceCode,
  j.id AS jobId,j.status AS jobStatus,j.evidence_level AS jobEvidenceLevel,
  j.request_json AS requestJson,j.completed_at AS completedAt,
  d.id AS datasetId,d.market AS datasetMarket,d.symbol AS datasetSymbol,
  d.interval AS datasetInterval,d.source AS datasetSource,
  d.requested_start_at AS requestedStartAt,d.requested_end_at AS requestedEndAt,
  d.complete AS datasetComplete,d.gaps_json AS gapsJson,d.checksum,
  r.id AS resultId,r.evidence_level AS resultEvidenceLevel,
  r.initial_capital AS initialCapital,r.fee_rate AS feeRate,r.slippage_rate AS slippageRate,
  r.leverage,r.funding_json AS fundingJson,r.provenance_json AS provenanceJson,
  r.engine_version AS engineVersion,r.configuration_hash AS configurationHash,
  r.strategy_hash AS strategyHash,r.script_hash AS scriptHash,
  p.discovery_market AS discoveryMarket,p.discovery_timeframe AS discoveryTimeframe,
  p.discovery_risk AS discoveryRisk,p.discovery_total_return AS discoveryTotalReturn,
  p.discovery_max_drawdown AS discoveryMaxDrawdown,p.discovery_win_rate AS discoveryWinRate,
  p.discovery_stability AS discoveryStability,p.discovery_recommended AS discoveryRecommended,
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
    AND r.strategy_hash=v.config_hash
    AND ((v.source_hash IS NULL AND r.script_hash IS NULL) OR r.script_hash=v.source_hash)
  JOIN backtest_datasets d ON d.backtest_job_id=j.id AND d.user_id=j.user_id
    AND d.id=r.dataset_id AND d.complete=1 AND d.gaps_json='[]'`;

const discoveryProjectionOf = (
  evidence: FormalEvidenceGateRow,
  description: string,
  publisherName: string,
) => {
  const config = typeof evidence.configJson === "string"
    ? JSON.parse(evidence.configJson) as Record<string, unknown> : evidence.configJson;
  const metrics = typeof evidence.metricsJson === "string"
    ? JSON.parse(evidence.metricsJson) as Record<string, unknown> : evidence.metricsJson;
  const leverage = Number(config.leverage);
  const totalReturn = Number(metrics.totalReturn);
  const maxDrawdown = Math.abs(Number(metrics.maxDrawdown));
  const winRate = Number(metrics.winRate);
  const sharpe = Number(metrics.sharpe);
  const trades = Number(metrics.trades);
  if (typeof config.name !== "string" || typeof config.market !== "string" || typeof config.symbol !== "string"
    || typeof config.timeframe !== "string"
    || ![leverage, totalReturn, maxDrawdown, winRate, sharpe, trades].every(Number.isFinite)) {
    throw new Error("publication discovery projection is invalid");
  }
  const risk: RiskLevel = leverage >= 10 || maxDrawdown >= 0.25
    ? "高"
    : leverage >= 3 || maxDrawdown >= 0.12 ? "中" : "低";
  const stability = Math.max(0, Math.min(100, 100 - maxDrawdown * 100));
  return {
    market: config.market as Market,
    timeframe: config.timeframe,
    risk,
    searchText: [config.name, description, publisherName, config.symbol].join(" ").toLowerCase(),
    totalReturn,
    maxDrawdown,
    winRate,
    stability,
    recommended: stability + sharpe * 12 - maxDrawdown * 100 + Math.min(trades, 100) / 20,
  };
};

export function createStrategyPublicationRepository(database: ControlPlaneDatabase) {
  const listPage = async (options: StrategyPublicationListOptions): Promise<{
    items: StrategyPublicationRecord[];
    nextCursor: StrategyPublicationCursor | null;
  }> => {
    exactInput(options, ["limit", "cursor", "search", "market", "timeframe", "risk", "sort", "slugs"]);
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100) {
      throw new Error("publication limit is invalid");
    }
    const sort = options.sort ?? "latest";
    const sortDefinition = {
      latest: { column: null, direction: "DESC" },
      recommended: { column: "p.discovery_recommended", direction: "DESC" },
      "return-desc": { column: "p.discovery_total_return", direction: "DESC" },
      "drawdown-asc": { column: "p.discovery_max_drawdown", direction: "ASC" },
      "win-rate-desc": { column: "p.discovery_win_rate", direction: "DESC" },
      "stability-desc": { column: "p.discovery_stability", direction: "DESC" },
    }[sort];
    if (!sortDefinition) throw new Error("publication sort is invalid");
    const where: string[] = [];
    const values: unknown[] = [];
    if (options.search !== undefined) {
      if (options.search.length < 1 || options.search.length > 80 || options.search.trim() !== options.search) {
        throw new Error("publication search is invalid");
      }
      where.push("p.search_text LIKE ? ESCAPE '\\'");
      values.push(`%${options.search.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`);
    }
    if (options.market !== undefined) {
      if (options.market !== "spot" && options.market !== "futures") throw new Error("publication market is invalid");
      where.push("p.discovery_market=?");
      values.push(options.market);
    }
    if (options.timeframe !== undefined) {
      if (!/^[A-Za-z0-9]{1,16}$/.test(options.timeframe)) throw new Error("publication timeframe is invalid");
      where.push("p.discovery_timeframe=?");
      values.push(options.timeframe);
    }
    if (options.risk !== undefined) {
      if (!(["低", "中", "高"] as const).includes(options.risk)) throw new Error("publication risk is invalid");
      where.push("p.discovery_risk=?");
      values.push(options.risk);
    }
    if (options.slugs !== undefined) {
      if (options.slugs.length < 1 || options.slugs.length > 24 || new Set(options.slugs).size !== options.slugs.length
        || options.slugs.some((slug) => !SLUG.test(slug))) throw new Error("publication slugs are invalid");
      where.push(`p.slug IN (${options.slugs.map(() => "?").join(",")})`);
      values.push(...options.slugs);
    }
    const cursor = options.cursor;
    if (cursor !== undefined) {
      exactInput(cursor, ["publishedAt", "id", "sortValue", "sort"]);
      const publishedAt = time(cursor.publishedAt, "cursor.publishedAt");
      const cursorId = id(cursor.id, "cursor.id");
      if (sortDefinition.column === null) {
        if (cursor.sortValue !== undefined || cursor.sort !== undefined) throw new Error("publication cursor is invalid");
        where.push("(p.published_at < ? OR (p.published_at = ? AND p.id < ?))");
        values.push(publishedAt, publishedAt, cursorId);
      } else {
        if (typeof cursor.sortValue !== "number" || !Number.isFinite(cursor.sortValue) || cursor.sort !== sort) {
          throw new Error("publication cursor is invalid");
        }
        const comparator = sortDefinition.direction === "ASC" ? ">" : "<";
        where.push(`(${sortDefinition.column} ${comparator} ? OR (${sortDefinition.column} = ? AND (p.published_at < ? OR (p.published_at = ? AND p.id < ?))))`);
        values.push(cursor.sortValue, cursor.sortValue, publishedAt, publishedAt, cursorId);
      }
    }
    const order = sortDefinition.column === null
      ? "p.published_at DESC,p.id DESC"
      : `${sortDefinition.column} ${sortDefinition.direction},p.published_at DESC,p.id DESC`;
    const result = await database.prepare(`SELECT ${projection} ${publishedJoin}
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY ${order} LIMIT ?`).bind(...values, options.limit + 1).all<StrategyPublicationRecord>();
    if (!result.success) throw new Error("publication list failed");
    const hasMore = result.results.length > options.limit;
    const items = result.results.slice(0, options.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? {
        publishedAt: last.publishedAt,
        id: last.id,
        ...(sortDefinition.column === null ? {} : {
          sortValue: ({
            recommended: last.discoveryRecommended,
            "return-desc": last.discoveryTotalReturn,
            "drawdown-asc": last.discoveryMaxDrawdown,
            "win-rate-desc": last.discoveryWinRate,
            "stability-desc": last.discoveryStability,
          } as const)[sort as StrategyDiscoverySort],
          sort: sort as StrategyDiscoverySort,
        }),
      } : null,
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
      const evidence = await database.prepare(`SELECT
          v.id AS strategyVersionId,v.config_hash AS configHash,v.source_hash AS sourceHash,
          v.config_json AS configJson,v.source_code AS sourceCode,
          j.id AS jobId,j.status AS jobStatus,j.evidence_level AS jobEvidenceLevel,
          j.request_json AS requestJson,j.completed_at AS completedAt,
          d.id AS datasetId,d.market AS datasetMarket,d.symbol AS datasetSymbol,
          d.interval AS datasetInterval,d.source AS datasetSource,
          d.requested_start_at AS requestedStartAt,d.requested_end_at AS requestedEndAt,
          d.actual_start_at AS actualStartAt,d.actual_end_at AS actualEndAt,
          d.complete AS datasetComplete,d.gaps_json AS gapsJson,d.checksum,
          r.id AS resultId,r.evidence_level AS resultEvidenceLevel,
          r.initial_capital AS initialCapital,r.fee_rate AS feeRate,
          r.slippage_rate AS slippageRate,r.leverage,r.funding_json AS fundingJson,
          r.metrics_json AS metricsJson,r.provenance_json AS provenanceJson,
          r.equity_curve_json AS equityCurveJson,r.engine_version AS engineVersion,
          r.configuration_hash AS configurationHash,r.strategy_hash AS strategyHash,
          r.script_hash AS scriptHash
        FROM strategy_versions v
        JOIN backtest_jobs j ON j.user_id=v.user_id AND j.strategy_version_id=v.id AND j.id=?
        JOIN backtest_results r ON r.user_id=j.user_id AND r.backtest_job_id=j.id
        JOIN backtest_datasets d ON d.user_id=j.user_id AND d.backtest_job_id=j.id AND d.id=r.dataset_id
        WHERE v.user_id=? AND v.id=? LIMIT 1`)
        .bind(jobId, owner, versionId).first<FormalEvidenceGateRow>();
      if (!evidence || !hasFormalBacktestEvidence(evidence)) return null;
      const discovery = discoveryProjectionOf(evidence, description.value, publisher.value);
      return database.prepare(`INSERT INTO strategy_publications
        (id,user_id,strategy_version_id,backtest_job_id,slug,description,publisher_name,weex_referral_url,
          discovery_market,discovery_timeframe,discovery_risk,search_text,discovery_total_return,
          discovery_max_drawdown,discovery_win_rate,discovery_stability,discovery_recommended,published_at,updated_at)
        SELECT ?,v.user_id,v.id,j.id,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
        FROM strategy_versions v
        JOIN backtest_jobs j ON j.user_id=v.user_id AND j.strategy_version_id=v.id
          AND j.id=? AND j.status='succeeded' AND j.evidence_level='historical'
        JOIN backtest_results r ON r.user_id=j.user_id AND r.backtest_job_id=j.id
          AND r.evidence_level='historical' AND r.configuration_hash=v.config_hash
          AND r.strategy_hash=v.config_hash
          AND ((v.source_hash IS NULL AND r.script_hash IS NULL) OR r.script_hash=v.source_hash)
        JOIN backtest_datasets d ON d.user_id=j.user_id AND d.backtest_job_id=j.id
          AND d.id=r.dataset_id AND d.complete=1 AND d.gaps_json='[]'
        WHERE v.user_id=? AND v.id=?
        ON CONFLICT(strategy_version_id) DO UPDATE SET
          backtest_job_id=excluded.backtest_job_id,
          description=excluded.description,
          publisher_name=excluded.publisher_name,
          discovery_market=excluded.discovery_market,
          discovery_timeframe=excluded.discovery_timeframe,
          discovery_risk=excluded.discovery_risk,
          search_text=excluded.search_text,
          discovery_total_return=excluded.discovery_total_return,
          discovery_max_drawdown=excluded.discovery_max_drawdown,
          discovery_win_rate=excluded.discovery_win_rate,
          discovery_stability=excluded.discovery_stability,
          discovery_recommended=excluded.discovery_recommended,
          updated_at=excluded.updated_at
        WHERE strategy_publications.user_id=excluded.user_id
        RETURNING id,user_id AS userId,strategy_version_id AS strategyVersionId,
          backtest_job_id AS backtestJobId,slug,'' AS name,description,publisher_name AS publisherName,
          weex_referral_url AS weexReferralUrl,'' AS market,'' AS symbol,'' AS configJson,
          '' AS metricsJson,'' AS equityCurveJson,NULL AS actualStartAt,NULL AS actualEndAt,
          discovery_market AS discoveryMarket,discovery_timeframe AS discoveryTimeframe,
          discovery_risk AS discoveryRisk,discovery_total_return AS discoveryTotalReturn,
          discovery_max_drawdown AS discoveryMaxDrawdown,discovery_win_rate AS discoveryWinRate,
          discovery_stability AS discoveryStability,discovery_recommended AS discoveryRecommended,
          published_at AS publishedAt,updated_at AS updatedAt`)
        .bind(publicationId, input.slug, description.value, publisher.value, null,
          discovery.market, discovery.timeframe, discovery.risk, discovery.searchText,
          discovery.totalReturn, discovery.maxDrawdown, discovery.winRate, discovery.stability,
          discovery.recommended, now, now,
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
