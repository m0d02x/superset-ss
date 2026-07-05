import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const productName = "Hyperset.app";
const projectRoot = join(import.meta.dirname, "..");
const sourceAppPath = join(projectRoot, "release", "mac-arm64", productName);
const targetAppPath = join("/Applications", productName);
const userDataPath = join(homedir(), ".hyperset");
const installMetadataPath = join(userDataPath, "install-metadata.json");

function fail(message: string): never {
	console.error(`[install-to-applications] ${message}`);
	process.exit(1);
}

function main(): void {
	if (!existsSync(sourceAppPath)) {
		fail(
			[
				"Built app bundle not found.",
				`Expected: ${sourceAppPath}`,
				"Run `bun run build` in apps/desktop first.",
			].join("\n"),
		);
	}

	if (existsSync(targetAppPath)) {
		console.log(
			`[install-to-applications] Removing existing app bundle at ${targetAppPath}`,
		);
		rmSync(targetAppPath, { recursive: true, force: true });
	}

	console.log(
		`[install-to-applications] Installing ${sourceAppPath} -> ${targetAppPath}`,
	);
	cpSync(sourceAppPath, targetAppPath, { recursive: true });
	mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
	writeFileSync(
		installMetadataPath,
		JSON.stringify(
			{
				installMethod: "manual-build-install",
				installedAt: new Date().toISOString(),
				targetAppPath,
			},
			null,
			2,
		),
	);

	console.log(
		`[install-to-applications] Preserved user data at ${userDataPath}`,
	);
	console.log(
		`[install-to-applications] Wrote install metadata to ${installMetadataPath}`,
	);
	console.log("[install-to-applications] Done");
}

main();
