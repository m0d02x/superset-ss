import { Button } from "@superset/ui/button";
import { Spinner } from "@superset/ui/spinner";
import { and, eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { env } from "renderer/env.renderer";
import { authClient } from "renderer/lib/auth-client";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { useOpenNewWorkspaceModal } from "renderer/stores/new-workspace-modal";
import { MOCK_ORG_ID } from "shared/constants";

function matchesLocalProject(
	githubRepository: { owner: string | null; name: string | null },
	localProject: {
		githubOwner: string | null;
		name: string;
		mainRepoPath: string;
	},
) {
	if (!githubRepository.owner || !githubRepository.name) {
		return false;
	}

	if (localProject.githubOwner !== githubRepository.owner) {
		return false;
	}

	if (localProject.name === githubRepository.name) {
		return true;
	}

	const directoryName = localProject.mainRepoPath.split("/").pop();
	return directoryName === githubRepository.name;
}

export const Route = createFileRoute("/_authenticated/_dashboard/local/")({
	component: LocalWorkspaceAliasPage,
});

function LocalWorkspaceAliasPage() {
	if (env.SKIP_ENV_VALIDATION) {
		return <SkipModeLocalWorkspaceAliasPage />;
	}

	return <LiveLocalWorkspaceAliasPage />;
}

function LiveLocalWorkspaceAliasPage() {
	const navigate = useNavigate();
	const collections = useCollections();
	const openNewWorkspaceModal = useOpenNewWorkspaceModal();
	const autoOpenedModalRef = useRef(false);
	const { data: session } = authClient.useSession();
	const { data: localProjects = [] } =
		electronTrpc.projects.getRecents.useQuery();
	const { data: deviceInfo, isPending: isDeviceInfoPending } =
		electronTrpc.auth.getDeviceInfo.useQuery();
	const activeOrganizationId = env.SKIP_ENV_VALIDATION
		? MOCK_ORG_ID
		: (session?.session?.activeOrganizationId ?? null);

	const { data: localWorkspaces } = useLiveQuery(
		(q) =>
			q
				.from({ workspaces: collections.v2Workspaces })
				.leftJoin(
					{ devices: collections.v2Devices },
					({ workspaces, devices }) => eq(workspaces.deviceId, devices.id),
				)
				.where(({ workspaces, devices }) =>
					and(
						eq(workspaces.organizationId, activeOrganizationId ?? ""),
						eq(devices?.clientId ?? "", deviceInfo?.deviceId ?? ""),
						eq(devices?.type ?? "", "host"),
					),
				)
				.orderBy(({ workspaces }) => workspaces.updatedAt, "desc")
				.select(({ workspaces }) => ({
					id: workspaces.id,
					name: workspaces.name,
				})),
		[activeOrganizationId, collections, deviceInfo?.deviceId],
	);

	const { data: candidateProjects = [] } = useLiveQuery(
		(q) =>
			q
				.from({ sidebarProjects: collections.v2SidebarProjects })
				.innerJoin(
					{ projects: collections.v2Projects },
					({ sidebarProjects, projects }) =>
						eq(sidebarProjects.projectId, projects.id),
				)
				.leftJoin(
					{ repos: collections.githubRepositories },
					({ projects, repos }) => eq(projects.githubRepositoryId, repos.id),
				)
				.orderBy(({ sidebarProjects }) => sidebarProjects.tabOrder, "asc")
				.select(({ projects, repos }) => ({
					id: projects.id,
					name: projects.name,
					githubOwner: repos?.owner ?? null,
					githubRepoName: repos?.name ?? null,
				})),
		[collections],
	);

	const targetWorkspaceId = useMemo(
		() => localWorkspaces?.[0]?.id ?? null,
		[localWorkspaces],
	);
	const matchedCandidateProjectIds = useMemo(() => {
		return candidateProjects
			.filter((project) =>
				localProjects.some((localProject) =>
					matchesLocalProject(
						{
							owner: project.githubOwner ?? null,
							name: project.githubRepoName ?? null,
						},
						localProject,
					),
				),
			)
			.map((project) => project.id);
	}, [candidateProjects, localProjects]);
	const singleCandidateProjectId =
		matchedCandidateProjectIds.length === 1
			? (matchedCandidateProjectIds[0] ?? null)
			: null;

	useEffect(() => {
		if (!targetWorkspaceId) {
			return;
		}

		navigate({
			to: "/v2-workspace/$workspaceId",
			params: { workspaceId: targetWorkspaceId },
			replace: true,
		});
	}, [navigate, targetWorkspaceId]);

	useEffect(() => {
		if (
			targetWorkspaceId ||
			autoOpenedModalRef.current ||
			!singleCandidateProjectId
		) {
			return;
		}

		autoOpenedModalRef.current = true;
		openNewWorkspaceModal(singleCandidateProjectId);
	}, [openNewWorkspaceModal, singleCandidateProjectId, targetWorkspaceId]);

	if (isDeviceInfoPending || localWorkspaces === undefined) {
		return (
			<div className="flex h-full w-full items-center justify-center">
				<Spinner className="size-5" />
			</div>
		);
	}

	if (targetWorkspaceId) {
		return (
			<div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
				Opening local workspace…
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col overflow-y-auto p-6">
			<div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
				<div className="space-y-2">
					<h1 className="text-2xl font-semibold tracking-tight">Local</h1>
					<p className="text-sm text-muted-foreground">
						No local V2 workspace is available yet. Choose a project to create
						one without using the server/VPS flow.
					</p>
				</div>

				<div className="flex flex-wrap gap-3">
					<Button
						onClick={() =>
							openNewWorkspaceModal(singleCandidateProjectId ?? undefined)
						}
					>
						{singleCandidateProjectId
							? "New Workspace in Project"
							: "New Workspace"}
					</Button>
					<Button
						variant="outline"
						onClick={() => navigate({ to: "/v2-workspaces" })}
					>
						Browse Workspaces
					</Button>
				</div>
			</div>
		</div>
	);
}

function SkipModeLocalWorkspaceAliasPage() {
	const navigate = useNavigate();

	return (
		<div className="flex h-full flex-col overflow-y-auto p-6">
			<div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
				<div className="space-y-2">
					<h1 className="text-2xl font-semibold tracking-tight">Local</h1>
					<p className="text-sm text-muted-foreground">
						Skip mode is active, so cloud-backed local workspace resolution is
						disabled. You can still use the local workspace shell and server
						tools.
					</p>
				</div>

				<div className="flex flex-wrap gap-3">
					<Button onClick={() => navigate({ to: "/workspace" })}>
						Open Workspace Home
					</Button>
					<Button
						variant="outline"
						onClick={() => navigate({ to: "/workspaces" })}
					>
						Browse Workspaces
					</Button>
				</div>
			</div>
		</div>
	);
}
