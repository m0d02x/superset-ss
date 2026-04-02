import { Alerter } from "@superset/ui/atoms/Alert";
import type { ReactNode } from "react";
import { PostHogUserIdentifier } from "renderer/components/PostHogUserIdentifier";
import { TelemetrySync } from "renderer/components/TelemetrySync";
import { ThemedToaster } from "renderer/components/ThemedToaster";
import { env } from "renderer/env.renderer";
import { AuthProvider } from "renderer/providers/AuthProvider";
import { ElectronTRPCProvider } from "renderer/providers/ElectronTRPCProvider";
import { PostHogProvider } from "renderer/providers/PostHogProvider";

export function RootLayout({ children }: { children: ReactNode }) {
	return (
		<PostHogProvider>
			<ElectronTRPCProvider>
				{!env.SKIP_ENV_VALIDATION && <PostHogUserIdentifier />}
				<TelemetrySync />
				<AuthProvider>
					{children}
					<ThemedToaster />
					<Alerter />
				</AuthProvider>
			</ElectronTRPCProvider>
		</PostHogProvider>
	);
}
