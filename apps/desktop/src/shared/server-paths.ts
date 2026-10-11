export function resolveServerSpaceDirectory(
	directory: string | null | undefined,
	baseDirectory: string | null | undefined,
): string | undefined {
	const trimmedDirectory = directory?.trim();
	if (!trimmedDirectory) return undefined;
	if (trimmedDirectory.startsWith("~")) return trimmedDirectory;

	const trimmedBase = baseDirectory?.trim().replace(/\/+$/, "");
	if (!trimmedBase) return trimmedDirectory;

	// Already under the base (e.g. stored before base directories existed):
	// don't prefix it a second time.
	if (
		trimmedDirectory === trimmedBase ||
		trimmedDirectory.startsWith(`${trimmedBase}/`)
	) {
		return trimmedDirectory;
	}

	const relativeDirectory = trimmedDirectory.replace(/^\/+/, "");
	if (!relativeDirectory) return trimmedBase;

	return `${trimmedBase}/${relativeDirectory}`;
}
