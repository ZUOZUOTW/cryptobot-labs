CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`device_id` text,
	`deployment_id` text,
	`strategy_version_id` text,
	`type` text NOT NULL,
	`correlation_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_user_occurred_idx` ON `audit_events` (`user_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_events_deployment_occurred_idx` ON `audit_events` (`deployment_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_events_correlation_idx` ON `audit_events` (`correlation_id`);--> statement-breakpoint
CREATE INDEX `audit_events_device_occurred_idx` ON `audit_events` (`device_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `backtest_datasets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`backtest_job_id` text NOT NULL,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`interval` text NOT NULL,
	`source` text NOT NULL,
	`requested_start_at` integer NOT NULL,
	`requested_end_at` integer NOT NULL,
	`actual_start_at` integer,
	`actual_end_at` integer,
	`complete` integer NOT NULL,
	`gaps_json` text NOT NULL,
	`checksum` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`backtest_job_id`,`user_id`) REFERENCES `backtest_jobs`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backtest_datasets_id_user_uidx` ON `backtest_datasets` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `backtest_datasets_job_uidx` ON `backtest_datasets` (`backtest_job_id`);--> statement-breakpoint
CREATE INDEX `backtest_datasets_user_created_idx` ON `backtest_datasets` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `backtest_datasets_checksum_idx` ON `backtest_datasets` (`checksum`);--> statement-breakpoint
CREATE TABLE `backtest_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`strategy_version_id` text NOT NULL,
	`status` text NOT NULL,
	`evidence_level` text NOT NULL,
	`request_json` text NOT NULL,
	`error_code` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`strategy_version_id`,`user_id`) REFERENCES `strategy_versions`(`id`,`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backtest_jobs_id_user_uidx` ON `backtest_jobs` (`id`,`user_id`);--> statement-breakpoint
CREATE INDEX `backtest_jobs_user_created_idx` ON `backtest_jobs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `backtest_jobs_user_status_idx` ON `backtest_jobs` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `backtest_results` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`backtest_job_id` text NOT NULL,
	`dataset_id` text NOT NULL,
	`evidence_level` text NOT NULL,
	`initial_capital` text NOT NULL,
	`fee_rate` text NOT NULL,
	`slippage_rate` text NOT NULL,
	`leverage` text NOT NULL,
	`funding_json` text NOT NULL,
	`metrics_json` text NOT NULL,
	`provenance_json` text NOT NULL,
	`equity_curve_json` text NOT NULL,
	`engine_version` text NOT NULL,
	`configuration_hash` text NOT NULL,
	`strategy_hash` text NOT NULL,
	`script_hash` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`backtest_job_id`,`user_id`) REFERENCES `backtest_jobs`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dataset_id`,`user_id`) REFERENCES `backtest_datasets`(`id`,`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backtest_results_id_user_uidx` ON `backtest_results` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `backtest_results_job_uidx` ON `backtest_results` (`backtest_job_id`);--> statement-breakpoint
CREATE INDEX `backtest_results_user_created_idx` ON `backtest_results` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `command_acknowledgements` (
	`id` text PRIMARY KEY NOT NULL,
	`command_id` text NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`status` text NOT NULL,
	`payload_json` text NOT NULL,
	`acknowledged_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`command_id`,`device_id`,`user_id`) REFERENCES `commands`(`id`,`device_id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `command_acknowledgements_id_user_uidx` ON `command_acknowledgements` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `command_acknowledgements_command_uidx` ON `command_acknowledgements` (`command_id`);--> statement-breakpoint
CREATE INDEX `command_acknowledgements_user_idx` ON `command_acknowledgements` (`user_id`);--> statement-breakpoint
CREATE TABLE `commands` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`deployment_id` text NOT NULL,
	`device_id` text NOT NULL,
	`type` text NOT NULL,
	`version` integer NOT NULL,
	`correlation_id` text NOT NULL,
	`expected_deployment_version` integer NOT NULL,
	`payload_json` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deployment_id`,`user_id`) REFERENCES `deployments`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`,`user_id`) REFERENCES `devices`(`id`,`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commands_id_user_uidx` ON `commands` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `commands_id_device_user_uidx` ON `commands` (`id`,`device_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `commands_user_correlation_uidx` ON `commands` (`user_id`,`correlation_id`);--> statement-breakpoint
CREATE INDEX `commands_device_status_created_idx` ON `commands` (`device_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `commands_user_created_idx` ON `commands` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`strategy_version_id` text NOT NULL,
	`name` text NOT NULL,
	`mode` text NOT NULL,
	`state` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`configuration_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`stopped_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`,`user_id`) REFERENCES `devices`(`id`,`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`strategy_version_id`,`user_id`) REFERENCES `strategy_versions`(`id`,`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deployments_id_user_uidx` ON `deployments` (`id`,`user_id`);--> statement-breakpoint
CREATE INDEX `deployments_user_state_idx` ON `deployments` (`user_id`,`state`);--> statement-breakpoint
CREATE INDEX `deployments_device_state_idx` ON `deployments` (`device_id`,`state`);--> statement-breakpoint
CREATE TABLE `device_bootstraps` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`pairing_code_id` text NOT NULL,
	`bootstrap_hash` text NOT NULL,
	`challenge_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`,`user_id`) REFERENCES `devices`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pairing_code_id`,`user_id`) REFERENCES `pairing_codes`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_bootstraps_device_uidx` ON `device_bootstraps` (`device_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_bootstraps_pairing_code_uidx` ON `device_bootstraps` (`pairing_code_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_bootstraps_hash_uidx` ON `device_bootstraps` (`bootstrap_hash`);--> statement-breakpoint
CREATE INDEX `device_bootstraps_expiry_idx` ON `device_bootstraps` (`expires_at`);--> statement-breakpoint
CREATE TABLE `device_credentials` (
	`device_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`credential_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`,`user_id`) REFERENCES `devices`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_credentials_hash_uidx` ON `device_credentials` (`credential_hash`);--> statement-breakpoint
CREATE INDEX `device_credentials_expiry_idx` ON `device_credentials` (`expires_at`);--> statement-breakpoint
CREATE TABLE `device_nonces` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`user_id` text NOT NULL,
	`nonce` text NOT NULL,
	`timestamp` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`,`user_id`) REFERENCES `devices`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_nonces_device_nonce_uidx` ON `device_nonces` (`device_id`,`nonce`);--> statement-breakpoint
CREATE INDEX `device_nonces_expiry_idx` ON `device_nonces` (`expires_at`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`platform` text NOT NULL,
	`public_key_jwk` text NOT NULL,
	`status` text NOT NULL,
	`paired_at` integer NOT NULL,
	`last_seen_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_id_user_uidx` ON `devices` (`id`,`user_id`);--> statement-breakpoint
CREATE INDEX `devices_user_status_idx` ON `devices` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `devices_user_last_seen_idx` ON `devices` (`user_id`,`last_seen_at`);--> statement-breakpoint
CREATE TABLE `fills` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`deployment_id` text NOT NULL,
	`order_id` text NOT NULL,
	`exchange_fill_id` text NOT NULL,
	`price` text NOT NULL,
	`quantity` text NOT NULL,
	`fee` text NOT NULL,
	`fee_currency` text NOT NULL,
	`realized_pnl` text,
	`filled_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`,`deployment_id`,`user_id`) REFERENCES `orders`(`id`,`deployment_id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fills_id_user_uidx` ON `fills` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `fills_order_exchange_fill_uidx` ON `fills` (`order_id`,`exchange_fill_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `fills_deployment_exchange_fill_uidx` ON `fills` (`deployment_id`,`exchange_fill_id`);--> statement-breakpoint
CREATE INDEX `fills_user_filled_idx` ON `fills` (`user_id`,`filled_at`);--> statement-breakpoint
CREATE INDEX `fills_deployment_filled_idx` ON `fills` (`deployment_id`,`filled_at`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`deployment_id` text NOT NULL,
	`client_order_id` text NOT NULL,
	`exchange_order_id` text,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`position_side` text NOT NULL,
	`order_type` text NOT NULL,
	`state` text NOT NULL,
	`price` text,
	`quantity` text NOT NULL,
	`filled_quantity` text NOT NULL,
	`average_fill_price` text,
	`notional` text NOT NULL,
	`correlation_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deployment_id`,`user_id`) REFERENCES `deployments`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_id_user_uidx` ON `orders` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_id_deployment_user_uidx` ON `orders` (`id`,`deployment_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_deployment_client_order_uidx` ON `orders` (`deployment_id`,`client_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_deployment_exchange_order_uidx` ON `orders` (`deployment_id`,`exchange_order_id`);--> statement-breakpoint
CREATE INDEX `orders_user_created_idx` ON `orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_exchange_order_idx` ON `orders` (`exchange_order_id`);--> statement-breakpoint
CREATE INDEX `orders_deployment_state_idx` ON `orders` (`deployment_id`,`state`);--> statement-breakpoint
CREATE TABLE `pairing_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pairing_codes_hash_uidx` ON `pairing_codes` (`code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `pairing_codes_id_user_uidx` ON `pairing_codes` (`id`,`user_id`);--> statement-breakpoint
CREATE INDEX `pairing_codes_user_expiry_idx` ON `pairing_codes` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `position_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`deployment_id` text NOT NULL,
	`heartbeat_id` text,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`quantity` text NOT NULL,
	`entry_price` text NOT NULL,
	`mark_price` text NOT NULL,
	`unrealized_pnl` text NOT NULL,
	`leverage` text NOT NULL,
	`captured_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deployment_id`,`user_id`) REFERENCES `deployments`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`heartbeat_id`,`deployment_id`,`user_id`) REFERENCES `run_heartbeats`(`id`,`deployment_id`,`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `position_snapshots_id_user_uidx` ON `position_snapshots` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `position_snapshots_deployment_symbol_side_uidx` ON `position_snapshots` (`deployment_id`,`symbol`,`side`);--> statement-breakpoint
CREATE INDEX `position_snapshots_deployment_captured_idx` ON `position_snapshots` (`deployment_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `position_snapshots_user_captured_idx` ON `position_snapshots` (`user_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `risk_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`deployment_id` text NOT NULL,
	`allowed_symbols_json` text NOT NULL,
	`max_order_notional` text NOT NULL,
	`max_position_notional` text NOT NULL,
	`max_total_exposure` text NOT NULL,
	`max_simultaneous_positions` integer NOT NULL,
	`max_daily_loss` text NOT NULL,
	`max_leverage` text NOT NULL,
	`max_slippage_bps` integer NOT NULL,
	`min_signal_cooldown_ms` integer NOT NULL,
	`max_consecutive_failures` integer NOT NULL,
	`operation_mode` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deployment_id`,`user_id`) REFERENCES `deployments`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `risk_policies_id_user_uidx` ON `risk_policies` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `risk_policies_deployment_uidx` ON `risk_policies` (`deployment_id`);--> statement-breakpoint
CREATE INDEX `risk_policies_user_idx` ON `risk_policies` (`user_id`);--> statement-breakpoint
CREATE TABLE `run_heartbeats` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`deployment_id` text NOT NULL,
	`device_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`mode` text NOT NULL,
	`state` text NOT NULL,
	`health` text NOT NULL,
	`summary_json` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deployment_id`,`user_id`) REFERENCES `deployments`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`,`user_id`) REFERENCES `devices`(`id`,`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_heartbeats_id_user_uidx` ON `run_heartbeats` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `run_heartbeats_id_deployment_user_uidx` ON `run_heartbeats` (`id`,`deployment_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `run_heartbeats_deployment_sequence_uidx` ON `run_heartbeats` (`deployment_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `run_heartbeats_user_occurred_idx` ON `run_heartbeats` (`user_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `strategies` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `strategies_id_user_uidx` ON `strategies` (`id`,`user_id`);--> statement-breakpoint
CREATE INDEX `strategies_user_updated_idx` ON `strategies` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `strategy_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`strategy_id` text NOT NULL,
	`version` integer NOT NULL,
	`config_hash` text NOT NULL,
	`source_hash` text,
	`config_json` text NOT NULL,
	`source_code` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`strategy_id`,`user_id`) REFERENCES `strategies`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `strategy_versions_id_user_uidx` ON `strategy_versions` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `strategy_versions_strategy_version_uidx` ON `strategy_versions` (`strategy_id`,`version`);--> statement-breakpoint
CREATE INDEX `strategy_versions_config_hash_idx` ON `strategy_versions` (`config_hash`);--> statement-breakpoint
CREATE INDEX `strategy_versions_source_hash_idx` ON `strategy_versions` (`source_hash`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`normalized_email` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_normalized_email_uidx` ON `users` (`normalized_email`);--> statement-breakpoint
CREATE TRIGGER audit_events_prevent_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events are append-only');
END;--> statement-breakpoint
CREATE TRIGGER audit_events_prevent_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events are append-only');
END;
