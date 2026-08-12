/**
 * Runtime identity is checked in the database instead of trusting the username
 * embedded in a connection URL. Supabase pooler usernames may include a project
 * suffix, while PostgreSQL current_user/session_user expose the actual role.
 */
export const POSTGRES_RUNTIME_IDENTITY_SQL = `select
  current_user::text as current_role,
  session_user::text as session_role,
  coalesce((select rolsuper from pg_catalog.pg_roles where rolname=current_user), true) as current_superuser,
  coalesce((select rolbypassrls from pg_catalog.pg_roles where rolname=current_user), true) as current_bypassrls,
  coalesce((select rolsuper from pg_catalog.pg_roles where rolname=session_user), true) as session_superuser,
  coalesce((select rolbypassrls from pg_catalog.pg_roles where rolname=session_user), true) as session_bypassrls`;

/**
 * @param {unknown} row
 * @param {"cryptobot_netlify" | "cryptobot_executor"} expectedRole
 */
export function assertPostgresRuntimeIdentity(row, expectedRole) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Postgres runtime identity is not ready");
  }
  const identity = /** @type {Record<string, unknown>} */ (row);
  if (identity.current_role !== expectedRole
    || identity.session_role !== expectedRole
    || identity.current_superuser !== false
    || identity.current_bypassrls !== false
    || identity.session_superuser !== false
    || identity.session_bypassrls !== false) {
    throw new Error("Postgres runtime identity is not ready");
  }
}

/**
 * This query intentionally checks catalog evidence rather than only migration
 * history. A repaired or partially applied database must prove the safety
 * objects that the current executor relies on before it can become ready.
 */
export const EXECUTOR_DATABASE_SCHEMA_SQL = `select
  to_regclass('public.cloud_strategy_runs') is not null as runs_table_ready,
  to_regclass('private.cloud_order_intents') is not null as orders_table_ready,
  to_regclass('public.weex_account_snapshots') is not null as account_snapshots_table_ready,
  to_regclass('public.weex_realized_pnl_ledger') is not null as realized_pnl_table_ready,
  exists (
    select 1 from pg_catalog.pg_attribute attribute
    where attribute.attrelid=to_regclass('private.cloud_order_intents')
      and attribute.attname='exchange_evidence_json'
      and attribute.atttypid='jsonb'::regtype
      and attribute.attnum > 0 and not attribute.attisdropped
  ) as order_evidence_column_ready,
  exists (
    select 1 from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid=to_regclass('private.cloud_order_intents')
      and constraint_record.conname='cloud_order_exchange_evidence_valid'
      and constraint_record.contype='c' and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid) like '%is_valid_cloud_order_evidence(exchange_evidence_json)%'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid) like '%clientOrderId%client_order_id%'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid) like '%exchangeOrderId%exchange_order_id%'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid) like '%exchange_order_filled%FILLED%'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid) like '%cumulativeFilledQuantity%'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid) like '%is_valid_cloud_order_evidence%'
  ) as order_evidence_constraint_ready,
  exists (
    select 1 from pg_catalog.pg_proc procedure
    where procedure.oid=to_regprocedure('private.is_valid_cloud_order_evidence(jsonb)')
      and not procedure.prosecdef and procedure.provolatile='i'
      and coalesce(procedure.proconfig,'{}'::text[]) @> array['search_path=""']::text[]
  ) as order_evidence_validator_ready,
  coalesce(pg_catalog.has_function_privilege(
    'cryptobot_executor',to_regprocedure('private.is_valid_cloud_order_evidence(jsonb)'),'EXECUTE'
  ),false)
  and not coalesce(pg_catalog.has_function_privilege(
    'cryptobot_netlify',to_regprocedure('private.is_valid_cloud_order_evidence(jsonb)'),'EXECUTE'
  ),true)
  and not coalesce(pg_catalog.has_function_privilege(
    'anon',to_regprocedure('private.is_valid_cloud_order_evidence(jsonb)'),'EXECUTE'
  ),true)
  and not coalesce(pg_catalog.has_function_privilege(
    'authenticated',to_regprocedure('private.is_valid_cloud_order_evidence(jsonb)'),'EXECUTE'
  ),true)
  and not coalesce(pg_catalog.has_function_privilege(
    'service_role',to_regprocedure('private.is_valid_cloud_order_evidence(jsonb)'),'EXECUTE'
  ),true) as order_evidence_validator_acl_ready,
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='cloud_strategy_runs'
      and column_name='market' and data_type='text' and is_nullable='NO'
  ) as market_column_ready,
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='cloud_strategy_runs'
      and column_name='symbol' and data_type='text' and is_nullable='NO'
  ) as symbol_column_ready,
  (
    select pg_catalog.pg_get_indexdef(indexes.indexrelid)
    from pg_catalog.pg_index indexes
    join pg_catalog.pg_class index_class on index_class.oid=indexes.indexrelid
    where index_class.relname='cloud_runs_nonterminal_target_uidx'
      and indexes.indrelid='public.cloud_strategy_runs'::regclass
      and indexes.indisunique and indexes.indisvalid and indexes.indisready
    limit 1
  ) as target_index_definition,
  (
    select pg_catalog.pg_get_expr(indexes.indpred,indexes.indrelid)
    from pg_catalog.pg_index indexes
    join pg_catalog.pg_class index_class on index_class.oid=indexes.indexrelid
    where index_class.relname='cloud_runs_nonterminal_target_uidx'
      and indexes.indrelid='public.cloud_strategy_runs'::regclass
      and indexes.indisunique and indexes.indisvalid and indexes.indisready
    limit 1
  ) as target_index_predicate,
  exists (
    select 1
    from pg_catalog.pg_trigger catalog_trigger
    where catalog_trigger.tgrelid='public.cloud_strategy_runs'::regclass
      and catalog_trigger.tgname='cloud_runs_synchronize_target'
      and not catalog_trigger.tgisinternal
      and catalog_trigger.tgenabled in ('O','A')
      and catalog_trigger.tgfoid=to_regprocedure('private.synchronize_cloud_run_target()')
      and (catalog_trigger.tgtype::integer & 1)=1
      and (catalog_trigger.tgtype::integer & 2)=2
      and (catalog_trigger.tgtype::integer & 4)=4
      and (catalog_trigger.tgtype::integer & 16)=16
  ) as target_trigger_ready,
  exists (
    select 1 from pg_catalog.pg_proc procedure
    where procedure.oid=to_regprocedure('private.synchronize_cloud_run_target()')
      and not procedure.prosecdef
      and coalesce(procedure.proconfig,'{}'::text[]) @> array['search_path=""']::text[]
  ) as target_function_ready,
  not coalesce(pg_catalog.has_function_privilege(
    'cryptobot_netlify',to_regprocedure('private.synchronize_cloud_run_target()'),'EXECUTE'
  ),true)
  and not coalesce(pg_catalog.has_function_privilege(
    'cryptobot_executor',to_regprocedure('private.synchronize_cloud_run_target()'),'EXECUTE'
  ),true)
  and not coalesce(pg_catalog.has_function_privilege(
    'anon',to_regprocedure('private.synchronize_cloud_run_target()'),'EXECUTE'
  ),true)
  and not coalesce(pg_catalog.has_function_privilege(
    'authenticated',to_regprocedure('private.synchronize_cloud_run_target()'),'EXECUTE'
  ),true)
  and not coalesce(pg_catalog.has_function_privilege(
    'service_role',to_regprocedure('private.synchronize_cloud_run_target()'),'EXECUTE'
  ),true) as target_function_acl_ready,
  exists (
    select 1
    from pg_catalog.pg_trigger catalog_trigger
    where catalog_trigger.tgrelid='public.cloud_strategy_runs'::regclass
      and catalog_trigger.tgname='cloud_runs_reject_unsettled_stop'
      and not catalog_trigger.tgisinternal
      and catalog_trigger.tgenabled in ('O','A')
      and catalog_trigger.tgfoid=to_regprocedure('private.reject_cloud_run_stop_with_unsettled_order()')
      and (catalog_trigger.tgtype::integer & 1)=1
      and (catalog_trigger.tgtype::integer & 2)=2
      and (catalog_trigger.tgtype::integer & 16)=16
  ) as stop_trigger_ready,
  exists (
    select 1 from pg_catalog.pg_proc procedure
    where procedure.oid=to_regprocedure('private.reject_cloud_run_stop_with_unsettled_order()')
      and procedure.prosecdef
      and coalesce(procedure.proconfig,'{}'::text[]) @> array['search_path=""']::text[]
  ) as stop_trigger_function_ready,
  not coalesce(pg_catalog.has_function_privilege(
    'cryptobot_netlify',to_regprocedure('private.reject_cloud_run_stop_with_unsettled_order()'),'EXECUTE'
  ),true)
  and not coalesce(pg_catalog.has_function_privilege(
    'cryptobot_executor',to_regprocedure('private.reject_cloud_run_stop_with_unsettled_order()'),'EXECUTE'
  ),true)
  and not coalesce(pg_catalog.has_function_privilege(
    'anon',to_regprocedure('private.reject_cloud_run_stop_with_unsettled_order()'),'EXECUTE'
  ),true)
  and not coalesce(pg_catalog.has_function_privilege(
    'authenticated',to_regprocedure('private.reject_cloud_run_stop_with_unsettled_order()'),'EXECUTE'
  ),true)
  and not coalesce(pg_catalog.has_function_privilege(
    'service_role',to_regprocedure('private.reject_cloud_run_stop_with_unsettled_order()'),'EXECUTE'
  ),true) as stop_trigger_function_acl_ready,
  exists (
    select 1 from pg_catalog.pg_proc procedure
    where procedure.oid=to_regprocedure('private.stop_cloud_strategy_run(text,text,bigint,bigint)')
      and procedure.prosecdef
      and coalesce(procedure.proconfig,'{}'::text[]) @> array['search_path=""']::text[]
  ) as stop_function_ready,
  coalesce(pg_catalog.has_function_privilege(
    'cryptobot_netlify',to_regprocedure('private.stop_cloud_strategy_run(text,text,bigint,bigint)'),'EXECUTE'
  ),false)
  and not coalesce(pg_catalog.has_function_privilege(
    'cryptobot_executor',to_regprocedure('private.stop_cloud_strategy_run(text,text,bigint,bigint)'),'EXECUTE'
  ),true)
  and not coalesce(pg_catalog.has_function_privilege(
    'anon',to_regprocedure('private.stop_cloud_strategy_run(text,text,bigint,bigint)'),'EXECUTE'
  ),true)
  and not coalesce(pg_catalog.has_function_privilege(
    'authenticated',to_regprocedure('private.stop_cloud_strategy_run(text,text,bigint,bigint)'),'EXECUTE'
  ),true)
  and not coalesce(pg_catalog.has_function_privilege(
    'service_role',to_regprocedure('private.stop_cloud_strategy_run(text,text,bigint,bigint)'),'EXECUTE'
  ),true) as stop_function_acl_ready`;

const normalizedSql = (value) => typeof value === "string"
  ? value.toLowerCase().replaceAll('"', "").replace(/\s+/gu, " ").trim()
  : "";

/** @param {unknown} row */
export function assertExecutorDatabaseSchema(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Cloud runtime database schema is not ready");
  }
  const evidence = /** @type {Record<string, unknown>} */ (row);
  const indexDefinition = normalizedSql(evidence.target_index_definition);
  const indexPredicate = normalizedSql(evidence.target_index_predicate).replace(/[()]/gu, "");
  const expectedIndexColumns = "user_id, connection_id, market, symbol";
  const indexReady = indexDefinition.includes("create unique index cloud_runs_nonterminal_target_uidx")
    && indexDefinition.includes("on public.cloud_strategy_runs")
    && indexDefinition.includes(`(${expectedIndexColumns})`)
    && /state\s*<>\s*'stopped'(?:::text)?/u.test(indexPredicate);
  if (evidence.runs_table_ready !== true
    || evidence.orders_table_ready !== true
    || evidence.account_snapshots_table_ready !== true
    || evidence.realized_pnl_table_ready !== true
    || evidence.order_evidence_column_ready !== true
    || evidence.order_evidence_constraint_ready !== true
    || evidence.order_evidence_validator_ready !== true
    || evidence.order_evidence_validator_acl_ready !== true
    || evidence.market_column_ready !== true
    || evidence.symbol_column_ready !== true
    || evidence.target_trigger_ready !== true
    || evidence.target_function_ready !== true
    || evidence.target_function_acl_ready !== true
    || evidence.stop_trigger_ready !== true
    || evidence.stop_trigger_function_ready !== true
    || evidence.stop_trigger_function_acl_ready !== true
    || evidence.stop_function_ready !== true
    || evidence.stop_function_acl_ready !== true
    || !indexReady) {
    throw new Error("Cloud runtime database schema is not ready");
  }
}

/**
 * Public strategy referral authorization is a website-only control-plane
 * dependency. Its readiness proof covers both schema shape and the
 * least-privilege contract used by the Netlify runtime.
 */
export const WEBSITE_DATABASE_SCHEMA_SQL = `select
  to_regclass('public.promoters') is not null as promoters_table_ready,
  (
    select count(*)=7
    from information_schema.columns
    where table_schema='public' and table_name='promoters'
      and column_name in (
        'user_id','slug','role','status','weex_referral_url','approved_at','updated_at'
      )
  ) as promoters_columns_ready,
  exists (
    select 1
    from pg_catalog.pg_class table_class
    join pg_catalog.pg_namespace namespace on namespace.oid=table_class.relnamespace
    where namespace.nspname='public' and table_class.relname='promoters'
      and table_class.relkind='r' and table_class.relrowsecurity
  ) as promoters_rls_ready,
  exists (
    select 1
    from pg_catalog.pg_policy policy
    where policy.polrelid=to_regclass('public.promoters')
      and policy.polname='netlify_server_runtime'
      and policy.polcmd='r'
      and (select oid from pg_catalog.pg_roles where rolname='cryptobot_netlify')=any(policy.polroles)
  ) as promoters_policy_ready,
  coalesce(pg_catalog.has_table_privilege(
    'cryptobot_netlify',to_regclass('public.promoters'),'SELECT'
  ),false) as promoters_select_ready,
  not coalesce(pg_catalog.has_table_privilege(
    'cryptobot_netlify',to_regclass('public.promoters'),'INSERT'
  ),true)
  and not coalesce(pg_catalog.has_table_privilege(
    'cryptobot_netlify',to_regclass('public.promoters'),'UPDATE'
  ),true)
  and not coalesce(pg_catalog.has_table_privilege(
    'cryptobot_netlify',to_regclass('public.promoters'),'DELETE'
  ),true)
  and not coalesce(pg_catalog.has_table_privilege(
    'cryptobot_netlify',to_regclass('public.promoters'),'TRUNCATE'
  ),true) as promoters_mutation_blocked,
  (
    select count(*)=4
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid=to_regclass('public.promoters')
      and constraint_record.convalidated
      and constraint_record.conname in (
        'promoters_role','promoters_status','promoters_weex_url','promoters_active_approval'
      )
  ) as promoters_constraints_ready,
  (
    select count(*)=9
    from information_schema.columns
    where table_schema='public' and table_name='strategy_publications'
      and column_name in (
        'discovery_market','discovery_timeframe','discovery_risk','search_text',
        'discovery_total_return','discovery_max_drawdown','discovery_win_rate',
        'discovery_stability','discovery_recommended'
      )
  ) as publication_discovery_columns_ready,
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid=to_regclass('public.strategy_publications')
      and tgname='strategy_publications_discovery_projection' and not tgisinternal and tgenabled='O'
  ) as publication_discovery_trigger_ready,
  (
    select count(*)=8
    from pg_catalog.pg_indexes
    where schemaname='public' and tablename='strategy_publications'
      and indexname in (
        'strategy_publications_market_timeframe_idx','strategy_publications_risk_published_idx',
        'strategy_publications_return_idx','strategy_publications_drawdown_idx',
        'strategy_publications_win_rate_idx','strategy_publications_stability_idx',
        'strategy_publications_recommended_idx','strategy_publications_search_trgm_idx'
      )
  ) as publication_discovery_indexes_ready,
  exists (
    select 1 from pg_catalog.pg_proc function_record
    where function_record.oid=to_regprocedure('public.derive_strategy_publication_discovery_projection()')
      and not function_record.prosecdef
  )
  and coalesce(pg_catalog.has_function_privilege(
    'cryptobot_netlify','public.derive_strategy_publication_discovery_projection()','EXECUTE'
  ),false)
  and not coalesce(pg_catalog.has_function_privilege(
    'cryptobot_executor','public.derive_strategy_publication_discovery_projection()','EXECUTE'
  ),true)
  and not coalesce(pg_catalog.has_function_privilege(
    'anon','public.derive_strategy_publication_discovery_projection()','EXECUTE'
  ),true)
  and not coalesce(pg_catalog.has_function_privilege(
    'authenticated','public.derive_strategy_publication_discovery_projection()','EXECUTE'
  ),true)
  and not coalesce(pg_catalog.has_function_privilege(
    'service_role','public.derive_strategy_publication_discovery_projection()','EXECUTE'
  ),true) as publication_discovery_function_ready,
  exists (
    select 1 from pg_catalog.pg_proc procedure
    where procedure.oid=to_regprocedure('private.list_cloud_run_order_evidence(text,text,integer)')
      and procedure.prosecdef
      and coalesce(procedure.proconfig,'{}'::text[]) @> array['search_path=""']::text[]
  ) as order_evidence_function_ready,
  coalesce(pg_catalog.has_function_privilege(
    'cryptobot_netlify',to_regprocedure('private.list_cloud_run_order_evidence(text,text,integer)'),'EXECUTE'
  ),false)
  and not coalesce(pg_catalog.has_function_privilege(
    'cryptobot_executor',to_regprocedure('private.list_cloud_run_order_evidence(text,text,integer)'),'EXECUTE'
  ),true)
  and not coalesce(pg_catalog.has_function_privilege(
    'anon',to_regprocedure('private.list_cloud_run_order_evidence(text,text,integer)'),'EXECUTE'
  ),true)
  and not coalesce(pg_catalog.has_function_privilege(
    'authenticated',to_regprocedure('private.list_cloud_run_order_evidence(text,text,integer)'),'EXECUTE'
  ),true)
  and not coalesce(pg_catalog.has_function_privilege(
    'service_role',to_regprocedure('private.list_cloud_run_order_evidence(text,text,integer)'),'EXECUTE'
  ),true) as order_evidence_function_acl_ready,
  not coalesce(pg_catalog.has_table_privilege(
    'cryptobot_netlify',to_regclass('private.cloud_order_intents'),'SELECT'
  ),true) as private_order_table_blocked`;

/** @param {unknown} row */
export function assertWebsiteDatabaseSchema(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Website control-plane database schema is not ready");
  }
  const evidence = /** @type {Record<string, unknown>} */ (row);
  if (evidence.promoters_table_ready !== true
    || evidence.promoters_columns_ready !== true
    || evidence.promoters_rls_ready !== true
    || evidence.promoters_policy_ready !== true
    || evidence.promoters_select_ready !== true
    || evidence.promoters_mutation_blocked !== true
    || evidence.promoters_constraints_ready !== true
    || evidence.publication_discovery_columns_ready !== true
    || evidence.publication_discovery_trigger_ready !== true
    || evidence.publication_discovery_indexes_ready !== true
    || evidence.publication_discovery_function_ready !== true
    || evidence.order_evidence_function_ready !== true
    || evidence.order_evidence_function_acl_ready !== true
    || evidence.private_order_table_blocked !== true) {
    throw new Error("Website control-plane database schema is not ready");
  }
}
