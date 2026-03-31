CREATE TABLE `server_spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`label` text NOT NULL,
	`directory` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `server_spaces_server_id_idx` ON `server_spaces` (`server_id`);