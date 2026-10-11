interface TreeItem {
	collapse: () => void;
	expand: () => void;
}

interface ActivateTreeEntryOptions {
	isDirectory: boolean;
	isExpanded: boolean;
	item: TreeItem;
	onOpenInEditor: () => void;
}

export function activateTreeEntry({
	isDirectory,
	isExpanded,
	item,
	onOpenInEditor,
}: ActivateTreeEntryOptions): void {
	if (isDirectory) {
		if (isExpanded) {
			item.collapse();
		} else {
			item.expand();
		}
		return;
	}

	onOpenInEditor();
}
