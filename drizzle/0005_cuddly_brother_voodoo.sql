CREATE TABLE `promoters` (
	`user_id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`weex_referral_url` text,
	`approved_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `promoters_slug_uidx` ON `promoters` (`slug`);--> statement-breakpoint
CREATE INDEX `promoters_status_role_idx` ON `promoters` (`status`,`role`);