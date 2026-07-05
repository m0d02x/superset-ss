export interface FileTreeNode {
	id: string;
	name: string;
	isDirectory: boolean;
	path: string;
	relativePath: string;
	children?: FileTreeNode[] | null;
	isLoading?: boolean;
}

export interface FileSystemChangeEvent {
	type: "create" | "update" | "delete" | "rename" | "overflow";
	absolutePath?: string;
	oldAbsolutePath?: string;
	relativePath?: string;
	oldRelativePath?: string;
	isDirectory?: boolean;
	revision: number;
}

export interface DirectoryEntry {
	id: string;
	name: string;
	path: string;
	relativePath: string;
	isDirectory: boolean;
}

export interface ExternalFileUploadSkippedItem {
	localPath: string;
	reason: string;
}

export type ExternalFileUploadConflictResolution =
	| "skip"
	| "overwrite"
	| "rename";

export interface ExternalFileUploadConflictItem {
	localPath: string;
	fileName: string;
	existingPath: string;
	reason: string;
}

export interface ExternalFileUploadOptions {
	conflictResolution?: ExternalFileUploadConflictResolution;
	conflictLocalPaths?: string[];
}

export interface ExternalFileUploadResult {
	uploadedCount: number;
	skipped: ExternalFileUploadSkippedItem[];
	conflicts: ExternalFileUploadConflictItem[];
	targetDirectoryPath: string;
}

export interface FileTreeDataAdapter {
	getChildren(path: string): Promise<DirectoryEntry[]>;
	createFile?(parentPath: string, name: string): Promise<void>;
	createDirectory?(parentPath: string, name: string): Promise<void>;
	rename?(absolutePath: string, newName: string): Promise<void>;
	deleteItems?(absolutePaths: string[]): Promise<void>;
	uploadExternalFiles?(
		targetDirectoryPath: string,
		localPaths: string[],
		options?: ExternalFileUploadOptions,
	): Promise<ExternalFileUploadResult>;
	searchFiles?(query: string): Promise<DirectoryEntry[]>;
	useFileEvents?(onEvent: (event: FileSystemChangeEvent) => void): void;
}
