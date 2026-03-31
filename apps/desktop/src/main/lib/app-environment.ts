import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { app } from "electron";
import { SUPERSET_DIR_NAME } from "shared/constants";

const SUPERSET_HOME_DIR_ENV = "SUPERSET_HOME_DIR";

function getDefaultSupersetHomeDir(): string {
	if (typeof app?.isPackaged === "boolean" && app.isPackaged) {
		return join(homedir(), ".hyperset");
	}

	return join(homedir(), SUPERSET_DIR_NAME);
}

export const SUPERSET_HOME_DIR =
	process.env[SUPERSET_HOME_DIR_ENV] || getDefaultSupersetHomeDir();
process.env[SUPERSET_HOME_DIR_ENV] = SUPERSET_HOME_DIR;
const LEGACY_SUPERSET_HOME_DIR = join(homedir(), ".superset");
const WORKSPACE_SUPERSET_HOME_DIR = join(homedir(), SUPERSET_DIR_NAME);

export const SUPERSET_HOME_DIR_MODE = 0o700;
export const SUPERSET_SENSITIVE_FILE_MODE = 0o600;

function fileExists(filePath: string): boolean {
	return existsSync(filePath);
}

function hasMeaningfulFile(filePath: string): boolean {
	if (!fileExists(filePath)) return false;
	try {
		return statSync(filePath).size > 0;
	} catch {
		return false;
	}
}

function scoreLegacySourceDir(sourceDir: string): number {
	const dbPath = join(sourceDir, "local.db");
	if (!hasMeaningfulFile(dbPath)) {
		return 0;
	}

	let db: Database.Database | null = null;
	try {
		db = new Database(dbPath, { readonly: true, fileMustExist: true });
		const tables = ["servers", "projects", "workspaces", "worktrees"];
		return tables.reduce((score, table) => {
			try {
				const row = db!
					.prepare(`SELECT COUNT(*) as count FROM ${table}`)
					.get() as { count?: number };
				return score + (row.count ?? 0);
			} catch {
				return score;
			}
		}, 0);
	} catch {
		return 0;
	} finally {
		db?.close();
	}
}

function migrateLegacySupersetHomeIfNeeded(): void {
	if (SUPERSET_HOME_DIR === LEGACY_SUPERSET_HOME_DIR) {
		return;
	}

	const legacySourceDirs = [
		WORKSPACE_SUPERSET_HOME_DIR,
		LEGACY_SUPERSET_HOME_DIR,
	]
		.filter((dir, index, all) => all.indexOf(dir) === index)
		.filter((dir) => dir !== SUPERSET_HOME_DIR && existsSync(dir))
		.sort((a, b) => scoreLegacySourceDir(b) - scoreLegacySourceDir(a));

	if (legacySourceDirs.length === 0) {
		return;
	}

	const filesToMigrate = ["local.db", "app-state.json", "window-state.json"];

	for (const fileName of filesToMigrate) {
		const targetPath = join(SUPERSET_HOME_DIR, fileName);
		if (hasMeaningfulFile(targetPath)) {
			continue;
		}

		for (const sourceDir of legacySourceDirs) {
			const legacyPath = join(sourceDir, fileName);
			if (!hasMeaningfulFile(legacyPath)) {
				continue;
			}

			try {
				copyFileSync(legacyPath, targetPath);
				if (fileName.endsWith(".db") || fileName.endsWith(".json")) {
					chmodSync(targetPath, SUPERSET_SENSITIVE_FILE_MODE);
				}
				console.log(
					`[app-environment] Migrated ${fileName} into ${SUPERSET_HOME_DIR}: ${legacyPath} -> ${targetPath}`,
				);
				break;
			} catch (error) {
				console.warn(
					`[app-environment] Failed to migrate ${fileName} from ${sourceDir}:`,
					error,
				);
			}
		}
	}
}

export function ensureSupersetHomeDirExists(): void {
	if (!existsSync(SUPERSET_HOME_DIR)) {
		mkdirSync(SUPERSET_HOME_DIR, {
			recursive: true,
			mode: SUPERSET_HOME_DIR_MODE,
		});
	}

	// Best-effort repair if the directory already existed with weak permissions.
	try {
		chmodSync(SUPERSET_HOME_DIR, SUPERSET_HOME_DIR_MODE);
	} catch (error) {
		console.warn(
			"[app-environment] Failed to chmod Superset home dir (best-effort):",
			SUPERSET_HOME_DIR,
			error,
		);
	}

	migrateLegacySupersetHomeIfNeeded();
}

// For lowdb - use our own path instead of app.getPath("userData")
export const APP_STATE_PATH = join(SUPERSET_HOME_DIR, "app-state.json");

// Window geometry state (separate from UI state - main process only, sync I/O)
export const WINDOW_STATE_PATH = join(SUPERSET_HOME_DIR, "window-state.json");
