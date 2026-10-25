import type { Metadata } from "next";
import { headers } from "next/headers";
import { JetBrains_Mono, Source_Sans_3 } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AppShell, SidebarProvider } from "@/components/sidebar";
import { ActivityProvider } from "@/components/activity-dock";
import { ServerEventsProvider } from "@/components/server-events";
import { AppearanceProvider } from "@/components/settings/appearance";
import UpdateBanner from "@/components/update-banner";
// The provider module itself ("use client"): the barrel also loads
// react-i18next, which a server component may not evaluate.
import { I18nProvider } from "@/components/i18n/provider";
import { parseAcceptLanguage, resolveLanguage, resolveSettings } from "@/src/core";
import { readSettingsRecord } from "@/src/server";

// Chrome = JetBrains Mono, teaching prose = Source Sans 3, titles = CMU
// Serif (the bundled lh-cmu @font-face in globals.css — no CDN).
const ui = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });
const prose = Source_Sans_3({ subsets: ["latin"], variable: "--font-sans3" });

export const metadata: Metadata = {
	title: "Learning Harness",
	description: "A teacher agent with a memory — sessions, quizzes, and a knowledge graph of what you know.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
	// The interface language (i18n wave, 2026-10-25), resolved HERE so the
	// first frame renders in it: the stored choice, and for "system" the
	// request's Accept-Language (Electron's Chromium sends the OS language).
	const setting = resolveSettings(readSettingsRecord() ?? null).general.language;
	const language = resolveLanguage(setting, parseAcceptLanguage((await headers()).get("accept-language")));
	return (
		<html lang={language} className={`dark ${ui.variable} ${prose.variable}`}>
			<body className="min-h-dvh antialiased">
			<I18nProvider setting={setting} language={language}>
			{/* The notification channel rides OUTSIDE everything: sidebar, dock,
				 and pages all subscribe as the polls retire (push S3, 2026-10-02). */}
			<ServerEventsProvider>
				<AppearanceProvider>
					<SidebarProvider>
						<ActivityProvider>
							<AppShell>{children}</AppShell>
						</ActivityProvider>
					</SidebarProvider>
				</AppearanceProvider>
			</ServerEventsProvider>
			{/* Auto-update banner (Wave C): fixed card, Electron-only pushes. */}
			<UpdateBanner />
			</I18nProvider>
		</body>
		</html>
	);
}
