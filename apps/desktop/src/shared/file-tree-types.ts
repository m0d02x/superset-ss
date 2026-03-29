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

export interface FileTreeDataAdapter {
	getChildren(path: string): Promise<DirectoryEntry[]>;
	createFile?(parentPath: string, name: string): Promise<void>;
	createDirectory?(parentPath: string, name: string): Promise<void>;
	rename?(absolutePath: string, newName: string): Promise<void>;
	deleteItems?(absolutePaths: string[]): Promise<void>;
	searchFiles?(query: string): Promise<DirectoryEntry[]>;
	useFileEvents?(onEvent: (event: FileSystemChangeEvent) => void): void;
}
