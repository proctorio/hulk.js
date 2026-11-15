import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const SRC__ = fileURLToPath(new URL("./src/", import.meta.url));
const PACKED_LIB__ = fileURLToPath(new URL("./.test_output/node_modules/@proctorio/hulk/lib/", import.meta.url));

// The "lib" project reruns every test against the packed package (test/PackSetup.js): an import that resolves into
// src/ is served from the same path in the package's lib/. The package lies under a node_modules directory with
// "type": "module", so vitest leaves it to Node: its own imports resolve natively, as they do for consumers.
const SRC_TO_PACKED_LIB__ = {
	name: "hulk-src-to-packed-lib",
	enforce: "pre",

	/**
	 * @description Serves an import that resolves into src/ from the packed lib/.
	 * @param {string} source - The import specifier.
	 * @param {string} importer - The importing file.
	 * @param {Object} options - Resolve options.
	 * @return {Promise<Object>} The packed file's resolution, or null to leave the import alone.
	 */
	async resolveId(source, importer, options)
	{
		const resolved = await this.resolve(source, importer, {
			...options,
			skipSelf: true
		});

		return resolved?.id.startsWith(SRC__)
			? {
				...resolved,
				id: PACKED_LIB__ + resolved.id.slice(SRC__.length)
			}
			: null;
	}
};

export default defineConfig({
	test:
	{
		include: ["test/**/*.{Test,test}.js"],
		globals: true,
		reporters: ["default", "junit"],
		outputFile:
		{
			junit: "./.test_output/test-results.xml"
		},
		coverage:
		{
			enabled: true,
			provider: "v8",
			include: ["src/**", "scripts/**"],
			reporter: ["text", "cobertura"],
			reportsDirectory: "./.test_output",
			thresholds:
			{
				branches: 80,
				statements: 80,
				functions: 80,
				lines: 80
			}
		},
		projects:
		[
			{
				extends: true,
				test:
				{
					name: "src",
					exclude: [...configDefaults.exclude, "test/Build.Test.js"]
				}
			},
			{
				extends: true,
				plugins: [SRC_TO_PACKED_LIB__],
				test:
				{
					name: "lib",
					globalSetup: ["test/PackSetup.js"]
				}
			}
		]
	}
});
