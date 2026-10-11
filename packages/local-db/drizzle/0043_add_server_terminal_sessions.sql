CREATE TABLE `server_terminal_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`space_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`tmux_session_name` text NOT NULL,
	`label` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_selected` integer DEFAULT false,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `server_spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `server_terminal_sessions_space_id_idx` ON `server_terminal_sessions` (`space_id`);
--> statement-breakpoint
CREATE INDEX `server_terminal_sessions_terminal_idx` ON `server_terminal_sessions` (`space_id`,`terminal_id`);
