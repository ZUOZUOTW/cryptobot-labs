CREATE TABLE `strategy_publications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`strategy_version_id` text NOT NULL,
	`backtest_job_id` text NOT NULL,
	`slug` text NOT NULL,
	`description` text NOT NULL,
	`publisher_name` text NOT NULL,
	`weex_referral_url` text NOT NULL,
	`published_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`strategy_version_id`,`user_id`) REFERENCES `strategy_versions`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`backtest_job_id`,`user_id`) REFERENCES `backtest_jobs`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `strategy_publications_slug_uidx` ON `strategy_publications` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `strategy_publications_version_uidx` ON `strategy_publications` (`strategy_version_id`);--> statement-breakpoint
CREATE INDEX `strategy_publications_published_idx` ON `strategy_publications` (`published_at`);--> statement-breakpoint
CREATE INDEX `strategy_publications_user_updated_idx` ON `strategy_publications` (`user_id`,`updated_at`);