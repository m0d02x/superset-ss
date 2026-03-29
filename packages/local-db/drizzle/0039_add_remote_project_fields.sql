ALTER TABLE `projects` ADD `server_id` text REFERENCES servers(id);--> statement-breakpoint
ALTER TABLE `projects` ADD `remote_repo_path` text;