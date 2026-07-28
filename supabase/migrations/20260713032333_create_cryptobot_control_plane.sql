CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"device_id" text,
	"deployment_id" text,
	"strategy_version_id" text,
	"type" text NOT NULL,
	"correlation_id" text NOT NULL,
	"payload_json" text NOT NULL,
	"occurred_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);;

CREATE TABLE IF NOT EXISTS "backtest_datasets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"backtest_job_id" text NOT NULL,
	"market" text NOT NULL,
	"symbol" text NOT NULL,
	"interval" text NOT NULL,
	"source" text NOT NULL,
	"requested_start_at" bigint NOT NULL,
	"requested_end_at" bigint NOT NULL,
	"actual_start_at" bigint,
	"actual_end_at" bigint,
	"complete" bigint NOT NULL,
	"gaps_json" text NOT NULL,
	"checksum" text NOT NULL,
	"created_at" bigint NOT NULL
);;

CREATE TABLE IF NOT EXISTS "backtest_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"strategy_version_id" text NOT NULL,
	"status" text NOT NULL,
	"evidence_level" text NOT NULL,
	"request_json" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" bigint NOT NULL,
	"started_at" bigint,
	"completed_at" bigint
);;

CREATE TABLE IF NOT EXISTS "backtest_request_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"backtest_job_id" text NOT NULL,
	"created_at" bigint NOT NULL
);;

CREATE TABLE IF NOT EXISTS "backtest_results" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"backtest_job_id" text NOT NULL,
	"dataset_id" text NOT NULL,
	"evidence_level" text NOT NULL,
	"initial_capital" text NOT NULL,
	"fee_rate" text NOT NULL,
	"slippage_rate" text NOT NULL,
	"leverage" text NOT NULL,
	"funding_json" text NOT NULL,
	"metrics_json" text NOT NULL,
	"provenance_json" text NOT NULL,
	"equity_curve_json" text NOT NULL,
	"engine_version" text NOT NULL,
	"configuration_hash" text NOT NULL,
	"strategy_hash" text NOT NULL,
	"script_hash" text,
	"created_at" bigint NOT NULL
);;

CREATE TABLE IF NOT EXISTS "command_acknowledgements" (
	"id" text PRIMARY KEY NOT NULL,
	"command_id" text NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"status" text NOT NULL,
	"payload_json" text NOT NULL,
	"acknowledged_at" bigint NOT NULL
);;

CREATE TABLE IF NOT EXISTS "commands" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"deployment_id" text NOT NULL,
	"device_id" text NOT NULL,
	"type" text NOT NULL,
	"version" bigint NOT NULL,
	"correlation_id" text NOT NULL,
	"expected_deployment_version" bigint NOT NULL,
	"payload_json" text NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL
);;

CREATE TABLE IF NOT EXISTS "deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"strategy_version_id" text NOT NULL,
	"name" text NOT NULL,
	"mode" text NOT NULL,
	"state" text NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"configuration_hash" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"started_at" bigint,
	"stopped_at" bigint
);;

CREATE TABLE IF NOT EXISTS "device_bootstraps" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"pairing_code_id" text NOT NULL,
	"bootstrap_hash" text NOT NULL,
	"challenge_hash" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"consumed_at" bigint,
	"created_at" bigint NOT NULL
);;

CREATE TABLE IF NOT EXISTS "device_credentials" (
	"device_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"credential_hash" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"revoked_at" bigint,
	"created_at" bigint NOT NULL
);;

CREATE TABLE IF NOT EXISTS "device_nonces" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"user_id" text NOT NULL,
	"nonce" text NOT NULL,
	"timestamp" bigint NOT NULL,
	"expires_at" bigint NOT NULL
);;

CREATE TABLE IF NOT EXISTS "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"public_key_jwk" text NOT NULL,
	"status" text NOT NULL,
	"paired_at" bigint NOT NULL,
	"last_seen_at" bigint,
	"revoked_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);;

CREATE TABLE IF NOT EXISTS "fills" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"deployment_id" text NOT NULL,
	"order_id" text NOT NULL,
	"exchange_fill_id" text NOT NULL,
	"price" text NOT NULL,
	"quantity" text NOT NULL,
	"fee" text NOT NULL,
	"fee_currency" text NOT NULL,
	"realized_pnl" text,
	"filled_at" bigint NOT NULL
);;

CREATE TABLE IF NOT EXISTS "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"deployment_id" text NOT NULL,
	"client_order_id" text NOT NULL,
	"exchange_order_id" text,
	"market" text NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"position_side" text NOT NULL,
	"order_type" text NOT NULL,
	"state" text NOT NULL,
	"price" text,
	"quantity" text NOT NULL,
	"filled_quantity" text NOT NULL,
	"average_fill_price" text,
	"notional" text NOT NULL,
	"correlation_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);;

CREATE TABLE IF NOT EXISTS "pairing_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"consumed_at" bigint,
	"created_at" bigint NOT NULL
);;

CREATE TABLE IF NOT EXISTS "position_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"deployment_id" text NOT NULL,
	"heartbeat_id" text,
	"market" text NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"quantity" text NOT NULL,
	"entry_price" text NOT NULL,
	"mark_price" text NOT NULL,
	"unrealized_pnl" text NOT NULL,
	"leverage" text NOT NULL,
	"captured_at" bigint NOT NULL
);;

CREATE TABLE IF NOT EXISTS "risk_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"deployment_id" text NOT NULL,
	"allowed_symbols_json" text NOT NULL,
	"max_order_notional" text NOT NULL,
	"max_position_notional" text NOT NULL,
	"max_total_exposure" text NOT NULL,
	"max_simultaneous_positions" bigint NOT NULL,
	"max_daily_loss" text NOT NULL,
	"max_leverage" text NOT NULL,
	"max_slippage_bps" bigint NOT NULL,
	"min_signal_cooldown_ms" bigint NOT NULL,
	"max_consecutive_failures" bigint NOT NULL,
	"operation_mode" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);;

CREATE TABLE IF NOT EXISTS "run_heartbeats" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"deployment_id" text NOT NULL,
	"device_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"mode" text NOT NULL,
	"state" text NOT NULL,
	"health" text NOT NULL,
	"summary_json" text NOT NULL,
	"occurred_at" bigint NOT NULL
);;

CREATE TABLE IF NOT EXISTS "strategies" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"market" text NOT NULL,
	"symbol" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);;

CREATE TABLE IF NOT EXISTS "strategy_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"strategy_id" text NOT NULL,
	"version" bigint NOT NULL,
	"config_hash" text NOT NULL,
	"source_hash" text,
	"config_json" text NOT NULL,
	"source_code" text,
	"created_at" bigint NOT NULL
);;

CREATE TABLE IF NOT EXISTS "strategy_save_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"strategy_version_id" text NOT NULL,
	"created_at" bigint NOT NULL
);;

CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"normalized_email" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);;

CREATE TABLE IF NOT EXISTS "device_connections" (
	"device_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"masked_api_key_suffix" text,
	"permissions_json" text NOT NULL,
	"verified_at" bigint,
	"status" text NOT NULL,
	"has_local_credential" bigint NOT NULL,
	"withdrawal_access_absent" bigint NOT NULL,
	"version" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);;

CREATE INDEX IF NOT EXISTS "audit_events_user_occurred_idx" ON "audit_events" ("user_id","occurred_at");;

CREATE INDEX IF NOT EXISTS "audit_events_deployment_occurred_idx" ON "audit_events" ("deployment_id","occurred_at");;

CREATE INDEX IF NOT EXISTS "audit_events_correlation_idx" ON "audit_events" ("correlation_id");;

CREATE INDEX IF NOT EXISTS "audit_events_device_occurred_idx" ON "audit_events" ("device_id","occurred_at");;

CREATE UNIQUE INDEX IF NOT EXISTS "backtest_datasets_id_user_uidx" ON "backtest_datasets" ("id","user_id");;

CREATE UNIQUE INDEX IF NOT EXISTS "backtest_datasets_job_uidx" ON "backtest_datasets" ("backtest_job_id");;

CREATE INDEX IF NOT EXISTS "backtest_datasets_user_created_idx" ON "backtest_datasets" ("user_id","created_at");;

CREATE INDEX IF NOT EXISTS "backtest_datasets_checksum_idx" ON "backtest_datasets" ("checksum");;

CREATE UNIQUE INDEX IF NOT EXISTS "backtest_jobs_id_user_uidx" ON "backtest_jobs" ("id","user_id");;

CREATE INDEX IF NOT EXISTS "backtest_jobs_user_created_idx" ON "backtest_jobs" ("user_id","created_at");;

CREATE INDEX IF NOT EXISTS "backtest_jobs_user_status_idx" ON "backtest_jobs" ("user_id","status");;

CREATE UNIQUE INDEX IF NOT EXISTS "backtest_request_keys_user_key_uidx" ON "backtest_request_keys" ("user_id","key");;

CREATE UNIQUE INDEX IF NOT EXISTS "backtest_request_keys_job_uidx" ON "backtest_request_keys" ("backtest_job_id");;

CREATE INDEX IF NOT EXISTS "backtest_request_keys_user_created_idx" ON "backtest_request_keys" ("user_id","created_at");;

CREATE UNIQUE INDEX IF NOT EXISTS "backtest_results_id_user_uidx" ON "backtest_results" ("id","user_id");;

CREATE UNIQUE INDEX IF NOT EXISTS "backtest_results_job_uidx" ON "backtest_results" ("backtest_job_id");;

CREATE INDEX IF NOT EXISTS "backtest_results_user_created_idx" ON "backtest_results" ("user_id","created_at");;

CREATE UNIQUE INDEX IF NOT EXISTS "command_acknowledgements_id_user_uidx" ON "command_acknowledgements" ("id","user_id");;

CREATE UNIQUE INDEX IF NOT EXISTS "command_acknowledgements_command_uidx" ON "command_acknowledgements" ("command_id");;

CREATE INDEX IF NOT EXISTS "command_acknowledgements_user_idx" ON "command_acknowledgements" ("user_id");;

CREATE UNIQUE INDEX IF NOT EXISTS "commands_id_user_uidx" ON "commands" ("id","user_id");;

CREATE UNIQUE INDEX IF NOT EXISTS "commands_id_device_user_uidx" ON "commands" ("id","device_id","user_id");;

CREATE UNIQUE INDEX IF NOT EXISTS "commands_user_correlation_uidx" ON "commands" ("user_id","correlation_id");;

CREATE INDEX IF NOT EXISTS "commands_device_status_created_idx" ON "commands" ("device_id","status","created_at");;

CREATE INDEX IF NOT EXISTS "commands_user_created_idx" ON "commands" ("user_id","created_at");;

CREATE UNIQUE INDEX IF NOT EXISTS "deployments_id_user_uidx" ON "deployments" ("id","user_id");;

CREATE INDEX IF NOT EXISTS "deployments_user_state_idx" ON "deployments" ("user_id","state");;

CREATE INDEX IF NOT EXISTS "deployments_device_state_idx" ON "deployments" ("device_id","state");;

CREATE UNIQUE INDEX IF NOT EXISTS "device_bootstraps_device_uidx" ON "device_bootstraps" ("device_id");;

CREATE UNIQUE INDEX IF NOT EXISTS "device_bootstraps_pairing_code_uidx" ON "device_bootstraps" ("pairing_code_id");;

CREATE UNIQUE INDEX IF NOT EXISTS "device_bootstraps_hash_uidx" ON "device_bootstraps" ("bootstrap_hash");;

CREATE INDEX IF NOT EXISTS "device_bootstraps_expiry_idx" ON "device_bootstraps" ("expires_at");;

CREATE UNIQUE INDEX IF NOT EXISTS "device_credentials_hash_uidx" ON "device_credentials" ("credential_hash");;

CREATE INDEX IF NOT EXISTS "device_credentials_expiry_idx" ON "device_credentials" ("expires_at");;

CREATE UNIQUE INDEX IF NOT EXISTS "device_nonces_device_nonce_uidx" ON "device_nonces" ("device_id","nonce");;

CREATE INDEX IF NOT EXISTS "device_nonces_expiry_idx" ON "device_nonces" ("expires_at");;

CREATE UNIQUE INDEX IF NOT EXISTS "devices_id_user_uidx" ON "devices" ("id","user_id");;

CREATE INDEX IF NOT EXISTS "devices_user_status_idx" ON "devices" ("user_id","status");;

CREATE INDEX IF NOT EXISTS "devices_user_last_seen_idx" ON "devices" ("user_id","last_seen_at");;

CREATE UNIQUE INDEX IF NOT EXISTS "fills_id_user_uidx" ON "fills" ("id","user_id");;

CREATE UNIQUE INDEX IF NOT EXISTS "fills_order_exchange_fill_uidx" ON "fills" ("order_id","exchange_fill_id");;

CREATE UNIQUE INDEX IF NOT EXISTS "fills_deployment_exchange_fill_uidx" ON "fills" ("deployment_id","exchange_fill_id");;

CREATE INDEX IF NOT EXISTS "fills_user_filled_idx" ON "fills" ("user_id","filled_at");;

CREATE INDEX IF NOT EXISTS "fills_deployment_filled_idx" ON "fills" ("deployment_id","filled_at");;

CREATE UNIQUE INDEX IF NOT EXISTS "orders_id_user_uidx" ON "orders" ("id","user_id");;

CREATE UNIQUE INDEX IF NOT EXISTS "orders_id_deployment_user_uidx" ON "orders" ("id","deployment_id","user_id");;

CREATE UNIQUE INDEX IF NOT EXISTS "orders_deployment_client_order_uidx" ON "orders" ("deployment_id","client_order_id");;

CREATE UNIQUE INDEX IF NOT EXISTS "orders_deployment_exchange_order_uidx" ON "orders" ("deployment_id","exchange_order_id");;

CREATE INDEX IF NOT EXISTS "orders_user_created_idx" ON "orders" ("user_id","created_at");;

CREATE INDEX IF NOT EXISTS "orders_exchange_order_idx" ON "orders" ("exchange_order_id");;

CREATE INDEX IF NOT EXISTS "orders_deployment_state_idx" ON "orders" ("deployment_id","state");;

CREATE UNIQUE INDEX IF NOT EXISTS "pairing_codes_hash_uidx" ON "pairing_codes" ("code_hash");;

CREATE UNIQUE INDEX IF NOT EXISTS "pairing_codes_id_user_uidx" ON "pairing_codes" ("id","user_id");;

CREATE INDEX IF NOT EXISTS "pairing_codes_user_expiry_idx" ON "pairing_codes" ("user_id","expires_at");;

CREATE UNIQUE INDEX IF NOT EXISTS "position_snapshots_id_user_uidx" ON "position_snapshots" ("id","user_id");;

CREATE UNIQUE INDEX IF NOT EXISTS "position_snapshots_deployment_symbol_side_uidx" ON "position_snapshots" ("deployment_id","symbol","side");;

CREATE INDEX IF NOT EXISTS "position_snapshots_deployment_captured_idx" ON "position_snapshots" ("deployment_id","captured_at");;

CREATE INDEX IF NOT EXISTS "position_snapshots_user_captured_idx" ON "position_snapshots" ("user_id","captured_at");;

CREATE UNIQUE INDEX IF NOT EXISTS "risk_policies_id_user_uidx" ON "risk_policies" ("id","user_id");;

CREATE UNIQUE INDEX IF NOT EXISTS "risk_policies_deployment_uidx" ON "risk_policies" ("deployment_id");;

CREATE INDEX IF NOT EXISTS "risk_policies_user_idx" ON "risk_policies" ("user_id");;

CREATE UNIQUE INDEX IF NOT EXISTS "run_heartbeats_id_user_uidx" ON "run_heartbeats" ("id","user_id");;

CREATE UNIQUE INDEX IF NOT EXISTS "run_heartbeats_id_deployment_user_uidx" ON "run_heartbeats" ("id","deployment_id","user_id");;

CREATE UNIQUE INDEX IF NOT EXISTS "run_heartbeats_deployment_sequence_uidx" ON "run_heartbeats" ("deployment_id","sequence");;

CREATE INDEX IF NOT EXISTS "run_heartbeats_user_occurred_idx" ON "run_heartbeats" ("user_id","occurred_at");;

CREATE UNIQUE INDEX IF NOT EXISTS "strategies_id_user_uidx" ON "strategies" ("id","user_id");;

CREATE INDEX IF NOT EXISTS "strategies_user_updated_idx" ON "strategies" ("user_id","updated_at");;

CREATE UNIQUE INDEX IF NOT EXISTS "strategy_versions_id_user_uidx" ON "strategy_versions" ("id","user_id");;

CREATE UNIQUE INDEX IF NOT EXISTS "strategy_versions_strategy_version_uidx" ON "strategy_versions" ("strategy_id","version");;

CREATE INDEX IF NOT EXISTS "strategy_versions_config_hash_idx" ON "strategy_versions" ("config_hash");;

CREATE INDEX IF NOT EXISTS "strategy_versions_source_hash_idx" ON "strategy_versions" ("source_hash");;

CREATE UNIQUE INDEX IF NOT EXISTS "strategy_save_keys_user_key_uidx" ON "strategy_save_keys" ("user_id","key");;

CREATE UNIQUE INDEX IF NOT EXISTS "strategy_save_keys_version_uidx" ON "strategy_save_keys" ("strategy_version_id");;

CREATE UNIQUE INDEX IF NOT EXISTS "users_normalized_email_uidx" ON "users" ("normalized_email");;

CREATE UNIQUE INDEX IF NOT EXISTS "device_connections_id_user_uidx" ON "device_connections" ("device_id","user_id");;

CREATE INDEX IF NOT EXISTS "device_connections_user_status_idx" ON "device_connections" ("user_id","status");;

ALTER TABLE public."audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."backtest_datasets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."backtest_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."backtest_request_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."backtest_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."command_acknowledgements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."commands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."deployments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."device_bootstraps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."device_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."device_nonces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."fills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."pairing_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."position_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."risk_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."run_heartbeats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."strategies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."strategy_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."strategy_save_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."device_connections" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.cbl_d1_batch(p_statements jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  item jsonb;
  binding jsonb;
  rendered text;
  mode text;
  marker integer;
  literal text;
  rows jsonb;
  changes bigint;
  results jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_statements) <> 'array' OR jsonb_array_length(p_statements) > 100 THEN
    RAISE EXCEPTION 'invalid statement batch';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_statements)
  LOOP
    rendered := btrim(item->>'sql');
    mode := item->>'mode';
    IF length(rendered) < 1 OR length(rendered) > 50000
      OR rendered !~* '^\\s*(select|insert|update|delete)\\b'
      OR rendered ~ '(;|--|/\\*|\\*/)' OR mode NOT IN ('first', 'all', 'run') THEN
      RAISE EXCEPTION 'invalid statement';
    END IF;
    FOR binding IN SELECT value FROM jsonb_array_elements(COALESCE(item->'bindings', '[]'::jsonb))
    LOOP
      marker := strpos(rendered, '?');
      IF marker = 0 THEN RAISE EXCEPTION 'binding count mismatch'; END IF;
      literal := CASE WHEN jsonb_typeof(binding) = 'null' THEN 'NULL'
        ELSE quote_nullable(binding #>> '{}') END;
      rendered := substr(rendered, 1, marker - 1) || literal || substr(rendered, marker + 1);
    END LOOP;
    IF strpos(rendered, '?') > 0 THEN RAISE EXCEPTION 'binding count mismatch'; END IF;
    IF mode = 'run' THEN
      EXECUTE rendered;
      GET DIAGNOSTICS changes = ROW_COUNT;
      rows := '[]'::jsonb;
    ELSIF mode = 'first' THEN
      EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) FROM (SELECT * FROM (%s) cbl_first LIMIT 1) q', rendered) INTO rows;
      changes := 0;
    ELSE
      EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) FROM (%s) q', rendered) INTO rows;
      changes := 0;
    END IF;
    results := results || jsonb_build_array(jsonb_build_object('rows', rows, 'changes', changes));
  END LOOP;
  RETURN results;
END;
$$;
REVOKE ALL ON FUNCTION public.cbl_d1_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cbl_d1_batch(jsonb) TO service_role;
