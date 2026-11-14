import { execSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Linter } from "eslint";

const ROOT__ = fileURLToPath(new URL("..", import.meta.url));

// The build runs npm and rewrites lib/; v8 coverage and slow agents stretch it well past the default.
const BUILD_MS__ = 60000;

// Kills a stuck build before the test limit: vitest cannot interrupt a synchronous execSync, and
// SIGKILL cannot be caught, so the call returns at the deadline even if the build ignores SIGTERM.
const BUILD_DEADLINE_MS__ = 50000;

// AST keys that hold positions, comments or ESLint's parent links rather than code.
const NOT_CODE__ = new Set(["start", "end", "loc", "range", "comments", "parent"]);

// ESLint (already a devDependency) parses with its own bundled parser; no rules run.
const LINTER__ = new Linter();

/**
 * @description Parses a JS module of the package with ESLint's parser, comments included.
 * @param {string} path - Path from the package root.
 * @return {Object} The AST, with a comments array.
 */
function parse(path)
{
	const messages = LINTER__.verify(readFileSync(`${ROOT__}${path}`, "utf8"), [
		{
			languageOptions: {
				ecmaVersion: "latest",
				sourceType: "module"
			}
		}
	]);

	// premise: the file parsed
	expect(messages).toEqual([]);

	return LINTER__.getSourceCode().ast;
}

/**
 * @description The code of an AST without positions or comments, for comparing two files.
 * @param {Object} ast - Parsed module.
 * @return {string} JSON of the code.
 */
function codeOf(ast)
{
	return JSON.stringify(ast, (key, value) =>
	{
		if (value === null || typeof value !== "object" || Array.isArray(value))
		{
			return value;
		}

		return Object.fromEntries(Object.entries(value).filter(([name]) => !NOT_CODE__.has(name)));
	});
}

describe("npm run build", () =>
{
	it("build publishes the JS comment helper with no comments and the same code", () =>
	{
		// premise: lib/ is rebuilt, not left over from an earlier build
		rmSync(`${ROOT__}lib`, {
			recursive: true,
			force: true
		});
		execSync("npm run build", {
			cwd: ROOT__,
			stdio: "pipe",
			timeout: BUILD_DEADLINE_MS__,
			killSignal: "SIGKILL"
		});

		const source = parse("src/JsComments.js");
		const built = parse("lib/JsComments.js");

		// premise: the source has comments for the build to strip
		expect(source.comments.length).toBeGreaterThan(0);

		expect(built.comments).toEqual([]);
		expect(codeOf(built)).toBe(codeOf(source));
	}, BUILD_MS__);
});
