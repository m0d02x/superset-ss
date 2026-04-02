import { Spinner } from "@superset/ui/spinner";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { getLocalSpaceWorkspaceId } from "renderer/lib/local-space-workspace";

export const Route = createFileRoute(
	"/_authenticated/_dashboard/local-space/$spaceId/",
)({
	component: LocalSpacePage,
});

function LocalSpacePage() {
	const { spaceId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate();
	const { data: localSpacesState } =
		electronTrpc.uiState.localSpaces.get.useQuery();
	const touchLocalSpace = electronTrpc.localSpaces.touch.useMutation();
	const touchLocalSpaceRef = useRef(touchLocalSpace.mutate);
	touchLocalSpaceRef.current = touchLocalSpace.mutate;
	const localSpace = useMemo(
		() =>
			localSpacesState?.spaces.find((space) => space.id === spaceId) ?? null,
		[localSpacesState?.spaces, spaceId],
	);
	const localSpaceId = localSpace?.id ?? null;

	useEffect(() => {
		if (!localSpaceId) {
			return;
		}

		let isCancelled = false;

		void Promise.resolve(
			touchLocalSpaceRef.current({ id: localSpaceId }),
		).finally(() => {
			if (isCancelled) {
				return;
			}

			void navigate({
				to: "/workspace/$workspaceId",
				params: { workspaceId: getLocalSpaceWorkspaceId(localSpaceId) },
				search,
				replace: true,
			});
		});

		return () => {
			isCancelled = true;
		};
	}, [localSpaceId, navigate, search]);

	if (!localSpace) {
		return (
			<div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
				Local space not found.
			</div>
		);
	}

	return (
		<div className="flex h-full w-full items-center justify-center">
			<Spinner className="size-5" />
		</div>
	);
}
