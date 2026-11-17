import "i18next";
import type { EN_RESOURCES } from "./resources.ts";

// Key types derive from the English reference files: t("shell:sidebar.x")
// with a key that doesn't exist in locales/en fails tsc.
declare module "i18next" {
	interface CustomTypeOptions {
		defaultNS: "common";
		resources: typeof EN_RESOURCES;
		returnNull: false;
	}
}
