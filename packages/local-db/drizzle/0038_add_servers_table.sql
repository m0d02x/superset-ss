CREATE TABLE `servers` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 22 NOT NULL,
	`username` text DEFAULT 'root' NOT NULL,
	`auth_method` text DEFAULT 'key' NOT NULL,
	`ssh_key_path` text,
	`host_service_port` integer DEFAULT 4879 NOT NULL,
	`host_service_secret` text,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`status_message` text,
	`last_connected_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `servers_host_idx` ON `servers` (`host`);