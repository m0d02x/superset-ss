import os from "node:os";
import { projects } from "@superset/local-db";
import { desc } from "drizzle-orm";
import { appState } from "main/lib/app-state";
import type { LocalSpace } from "main/lib/app-state/schemas";
import { localDb } from "main/lib/local-db";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { publicProcedure, router } from "../..";

const localSpaceInput = z.object({
	label: z.string().min(1),
	directory: z.string().optional(),
	color: z.string().nullable().optional(),
});

const updateLocalSpaceInput = z.object({
	id: z.string(),
	label: z.string().min(1).optional(),
	directory: z.string().nullable().optional(),
	color: z.string().nullable().optional(),
});

function getSortedSpaces(): LocalSpace[] {
	return [...appState.data.localSpaces.spaces].sort(
		(a, b) => a.sortOrder - b.sortOrder || b.updatedAt - a.updatedAt,
	);
}

export const createLocalSpacesRouter = () => {
	return router({
		list: publicProcedure.query(() => getSortedSpaces()),

		create: publicProcedure
			.input(localSpaceInput)
			.mutation(async ({ input }) => {
				const spaces = getSortedSpaces();
				const now = Date.now();
				const mostRecentProject = localDb
					.select({ mainRepoPath: projects.mainRepoPath })
					.from(projects)
					.orderBy(desc(projects.lastOpenedAt))
					.get();
				const nextSpace: LocalSpace = {
					id: uuidv4(),
					label: input.label,
					directory:
						input.directory ?? mostRecentProject?.mainRepoPath ?? os.homedir(),
					color: input.color ?? undefined,
					sortOrder: spaces.length,
					createdAt: now,
					updatedAt: now,
					lastOpenedAt: now,
				};

				appState.data.localSpaces.spaces = [...spaces, nextSpace];
				await appState.write();
				return nextSpace;
			}),

		update: publicProcedure
			.input(updateLocalSpaceInput)
			.mutation(async ({ input }) => {
				const now = Date.now();
				let updated: LocalSpace | null = null;
				appState.data.localSpaces.spaces = appState.data.localSpaces.spaces.map(
					(space) => {
						if (space.id !== input.id) {
							return space;
						}

						updated = {
							...space,
							label: input.label?.trim() || space.label,
							directory:
								input.directory === null
									? undefined
									: (input.directory ?? space.directory),
							color:
								input.color === null ? undefined : (input.color ?? space.color),
							updatedAt: now,
						};

						return updated;
					},
				);
				await appState.write();
				if (!updated) {
					throw new Error(`Local space ${input.id} not found`);
				}
				return updated;
			}),

		delete: publicProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input }) => {
				appState.data.localSpaces.spaces = getSortedSpaces()
					.filter((space) => space.id !== input.id)
					.map((space, index) => ({ ...space, sortOrder: index }));
				await appState.write();
				return { success: true };
			}),

		touch: publicProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input }) => {
				const now = Date.now();
				appState.data.localSpaces.spaces = appState.data.localSpaces.spaces.map(
					(space) =>
						space.id === input.id
							? { ...space, lastOpenedAt: now, updatedAt: now }
							: space,
				);
				await appState.write();
				return { success: true };
			}),
	});
};
