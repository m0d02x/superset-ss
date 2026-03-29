import { Button } from "@superset/ui/button";
import { Maximize2, Minimize2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MarkdownRenderer } from "renderer/components/MarkdownRenderer/MarkdownRenderer";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { CodeEditor } from "renderer/screens/main/components/WorkspaceView/components/CodeEditor";

interface RemoteFileViewerProps {
	serverId: string;
	filePath: string;
	onClose?: () => void;
}

function getLanguageFromPath(filePath: string): string {
	const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
	const map: Record<string, string> = {
		js: "javascript",
		jsx: "javascript",
		ts: "typescript",
		tsx: "typescript",
		py: "python",
		rb: "ruby",
		rs: "rust",
		go: "go",
		java: "java",
		cpp: "cpp",
		c: "cpp",
		h: "cpp",
		hpp: "cpp",
		css: "css",
		scss: "css",
		html: "html",
		htm: "html",
		xml: "xml",
		svg: "xml",
		json: "json",
		yaml: "yaml",
		yml: "yaml",
		md: "markdown",
		mdx: "markdown",
		sql: "sql",
		sh: "shell",
		bash: "shell",
		zsh: "shell",
		php: "php",
		toml: "toml",
		dockerfile: "dockerfile",
	};
	return map[ext] ?? "text";
}

export function RemoteFileViewer({
	serverId,
	filePath,
	onClose,
}: RemoteFileViewerProps) {
	const { data, isLoading } = electronTrpc.servers.readFile.useQuery({
		id: serverId,
		path: filePath,
	});
	const writeMutation = electronTrpc.servers.writeFile.useMutation();
	const utils = electronTrpc.useUtils();

	const [editContent, setEditContent] = useState<string | null>(null);
	const isEditing = editContent !== null;
	const isDirty = isEditing && editContent !== (data?.content ?? "");

	const language = useMemo(() => getLanguageFromPath(filePath), [filePath]);
	const isMarkdown = language === "markdown";
	const [viewMode, setViewMode] = useState<"rendered" | "raw">("rendered");
	const [isZenMode, setIsZenMode] = useState(false);

	// Reset edit state and view mode when file changes
	useEffect(() => {
		setEditContent(null);
		setViewMode("rendered");
		setIsZenMode(false);
	}, [filePath]);

	const setTrafficLights = electronTrpc.window.setTrafficLightsVisible.useMutation();

	// Hide traffic lights in zen mode, restore on exit or unmount
	useEffect(() => {
		if (isZenMode) {
			setTrafficLights.mutate({ visible: false });
		} else {
			setTrafficLights.mutate({ visible: true });
		}
		return () => {
			setTrafficLights.mutate({ visible: true });
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isZenMode]);

	// Escape key exits zen mode
	useEffect(() => {
		if (!isZenMode) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setIsZenMode(false);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isZenMode]);

	const handleSave = useCallback(() => {
		if (editContent === null) return;
		writeMutation.mutate(
			{ id: serverId, path: filePath, content: editContent },
			{
				onSuccess: () => {
					setEditContent(null);
					utils.servers.readFile.invalidate({ id: serverId, path: filePath });
				},
			},
		);
	}, [editContent, serverId, filePath, writeMutation, utils]);

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center text-xs text-muted-foreground">
				Loading...
			</div>
		);
	}

	if (data?.error || data?.content === null) {
		return (
			<div className="flex h-full flex-col">
				<div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
					<span className="text-xs font-medium truncate">
						{filePath.split("/").pop()}
					</span>
					{onClose && (
						<button
							type="button"
							className="rounded p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0 ml-auto"
							onClick={onClose}
						>
							<X className="size-3.5" />
						</button>
					)}
				</div>
				<div className="flex flex-1 items-center justify-center text-xs text-red-500">
					{data?.error ?? "Failed to read file"}
				</div>
			</div>
		);
	}

	const content = (
		<div className="flex h-full flex-col bg-background">
			<div className="flex items-center gap-2 border-b border-border px-3 h-10 shrink-0">
				<span className="text-xs font-medium truncate">
					{filePath.split("/").pop()}
				</span>
				{isDirty && (
					<span className="size-1.5 rounded-full bg-amber-500 shrink-0" />
				)}
				<span className="text-[10px] text-muted-foreground truncate ml-auto max-w-48">
					{filePath}
				</span>
				{isMarkdown && !isEditing && (
					<div className="flex items-center gap-0.5 rounded-md border border-border p-0.5 shrink-0">
						<button
							type="button"
							className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
								viewMode === "rendered"
									? "bg-muted text-foreground"
									: "text-muted-foreground hover:text-foreground"
							}`}
							onClick={() => setViewMode("rendered")}
						>
							Rendered
						</button>
						<button
							type="button"
							className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
								viewMode === "raw"
									? "bg-muted text-foreground"
									: "text-muted-foreground hover:text-foreground"
							}`}
							onClick={() => setViewMode("raw")}
						>
							Raw
						</button>
					</div>
				)}
				{!isEditing ? (
					<Button
						size="sm"
						variant="ghost"
						className="h-6 text-xs shrink-0"
						onClick={() => {
							setEditContent(data?.content ?? "");
							setViewMode("raw");
						}}
					>
						Edit
					</Button>
				) : (
					<>
						<Button
							size="sm"
							variant="ghost"
							className="h-6 text-xs shrink-0"
							onClick={() => setEditContent(null)}
						>
							Cancel
						</Button>
						<Button
							size="sm"
							variant="default"
							className="h-6 text-xs shrink-0"
							onClick={handleSave}
							disabled={writeMutation.isPending || !isDirty}
						>
							{writeMutation.isPending ? "Saving..." : "Save"}
						</Button>
					</>
				)}
				<button
					type="button"
					className="rounded p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
					onClick={() => setIsZenMode((v) => !v)}
					title={isZenMode ? "Exit zen mode (Esc)" : "Zen mode"}
				>
					{isZenMode ? (
						<Minimize2 className="size-3.5" />
					) : (
						<Maximize2 className="size-3.5" />
					)}
				</button>
				{onClose && !isZenMode && (
					<button
						type="button"
						className="rounded p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
						onClick={onClose}
					>
						<X className="size-3.5" />
					</button>
				)}
			</div>

			<div className="flex-1 min-h-0 overflow-hidden">
				{isMarkdown && !isEditing && viewMode === "rendered" ? (
					<MarkdownRenderer
						content={data?.content ?? ""}
						className="p-4"
					/>
				) : (
					<CodeEditor
						value={isEditing ? editContent : (data?.content ?? "")}
						language={language}
						readOnly={!isEditing}
						onChange={isEditing ? setEditContent : undefined}
						onSave={isEditing ? handleSave : undefined}
					/>
				)}
			</div>
		</div>
	);

	if (isZenMode) {
		return (
			<div className="fixed inset-0 z-50">
				{content}
			</div>
		);
	}

	return content;
}
