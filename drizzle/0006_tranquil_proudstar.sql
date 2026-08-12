ALTER TABLE `strategy_publications` ADD `discovery_market` text DEFAULT 'spot' NOT NULL;--> statement-breakpoint
ALTER TABLE `strategy_publications` ADD `discovery_timeframe` text DEFAULT '1h' NOT NULL;--> statement-breakpoint
ALTER TABLE `strategy_publications` ADD `discovery_risk` text DEFAULT '低' NOT NULL;--> statement-breakpoint
ALTER TABLE `strategy_publications` ADD `search_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `strategy_publications` ADD `discovery_total_return` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `strategy_publications` ADD `discovery_max_drawdown` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `strategy_publications` ADD `discovery_win_rate` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `strategy_publications` ADD `discovery_stability` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `strategy_publications` ADD `discovery_recommended` real DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `strategy_publications_market_timeframe_idx` ON `strategy_publications` (`discovery_market`,`discovery_timeframe`,`published_at`);--> statement-breakpoint
CREATE INDEX `strategy_publications_risk_published_idx` ON `strategy_publications` (`discovery_risk`,`published_at`);--> statement-breakpoint
CREATE INDEX `strategy_publications_return_idx` ON `strategy_publications` (`discovery_total_return`,`published_at`);--> statement-breakpoint
CREATE INDEX `strategy_publications_drawdown_idx` ON `strategy_publications` (`discovery_max_drawdown`,`published_at`);--> statement-breakpoint
CREATE INDEX `strategy_publications_win_rate_idx` ON `strategy_publications` (`discovery_win_rate`,`published_at`);--> statement-breakpoint
CREATE INDEX `strategy_publications_stability_idx` ON `strategy_publications` (`discovery_stability`,`published_at`);--> statement-breakpoint
CREATE INDEX `strategy_publications_recommended_idx` ON `strategy_publications` (`discovery_recommended`,`published_at`);