CREATE TABLE `device_connections` (
	`device_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`masked_api_key_suffix` text,
	`permissions_json` text NOT NULL,
	`verified_at` integer,
	`status` text NOT NULL,
	`has_local_credential` integer NOT NULL,
	`withdrawal_access_absent` integer NOT NULL,
	`version` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`,`user_id`) REFERENCES `devices`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_connections_id_user_uidx` ON `device_connections` (`device_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `device_connections_user_status_idx` ON `device_connections` (`user_id`,`status`);
