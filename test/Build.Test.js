import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Linter } from "eslint";
import minify__ from "../src/index.js";
import { buildLib__ } from "../scripts/BuildLib.js";

// Runs in the "lib" project only (vitest.config.js): test/PackSetup.js has packed hulk with npm pack and installed
// the tarball in .test_output/, and every import of src/ in this project is served from the package's lib/.
const ROOT__ = fileURLToPath(new URL("..", import.meta.url));
const SRC__ = join(ROOT__, "src");
const CONSUMER__ = join(ROOT__, ".test_output");
const PACKAGE__ = join(CONSUMER__, "node_modules", "@proctorio", "hulk");
const PACKED_LIB__ = join(PACKAGE__, "lib");

// ESLint (already a devDependency) parses with the parser the org lint uses; no rules run.
const LINTER__ = new Linter();

/**
 * @description Parses a JS module the way the org lint does.
 * @param {string} code - Module source.
 * @return {{comments: Array<string>, tokens: Array<string>}} Its comments and its tokens, in order.
 */
function lex(code)
{
	const messages = LINTER__.verify(code, [
		{
			languageOptions: {
				ecmaVersion: "latest",
				sourceType: "module"
			}
		}
	]);

	// premise: the code parsed (a parse error leaves no tokens or comments to compare)
	expect(messages).toEqual([]);
	const sourceCode = LINTER__.getSourceCode();

	return {
		comments: sourceCode.getAllComments().map(comment => comment.value),
		tokens: sourceCode.ast.tokens.map(token => `${token.type} ${token.value}`)
	};
}

const filesUnder = dir => readdirSync(dir, {
	recursive: true,
	withFileTypes: true
})
	.filter(entry => entry.isFile())
	.map(entry => join(entry.parentPath, entry.name).slice(dir.length + 1))
	.sort();
const read = (dir, file) => readFileSync(join(dir, file), "utf8");

describe("the package npm pack builds", () =>
{
	const jsFiles = filesUnder(SRC__).filter(file => file.endsWith(".js"));

	it("is what this project's tests import, as Node loads it", () =>
	{
		// Node's own loader (require of an ES module shares its cache): the same function, not a copy of src/'s
		// that vitest transformed.
		const packed = createRequire(import.meta.url)(join(PACKED_LIB__, "index.js"));

		expect(minify__).toBe(packed.default);
	});

	it("holds src/'s files under lib/, besides package.json, LICENSE and README.md", () =>
	{
		const expected = [...filesUnder(SRC__).map(file => join("lib", file)), "LICENSE", "README.md", "package.json"];

		expect(filesUnder(PACKAGE__)).toEqual(expected.sort());
	});

	it("has no comments in any .js file of lib/", () =>
	{
		expect(jsFiles.length).toBeGreaterThan(0);

		// premise: there are comments to strip
		expect(jsFiles.filter(file => lex(read(SRC__, file)).comments.length > 0)).not.toEqual([]);
		for (const file of jsFiles)
		{
			expect({
				file,
				comments: lex(read(PACKED_LIB__, file)).comments
			}).toEqual({
				file,
				comments: []
			});
		}
	});

	it("keeps every token of src/, in order", () =>
	{
		// hulk's JS minifier removes only comments and whitespace. A token it changed (for example a template literal
		// line that starts with "//" or "/*", 47101) fails here, so the build never ships it.
		for (const file of jsFiles)
		{
			expect({
				file,
				tokens: lex(read(PACKED_LIB__, file)).tokens
			}).toEqual({
				file,
				tokens: lex(read(SRC__, file)).tokens
			});
		}
	});

	it("works for a consumer that imports or requires it by name", () =>
	{
		const samples = [
			["<div>\n  <!-- c -->\n  <p>a  b</p>\n</div>\n", "html"],
			["a {\n  color: red; /* c */\n}\n", "css"],
			["<svg>\n  <!-- c -->\n  <g />\n</svg>\n", "svg"],
			["const a = 1; // c\n/* d */\nconst b = `// e`;\n", "js"],
			["{\n  \"a\": 1,\n  \"b\": [1, 2]\n}\n", "json"]
		];
		const script = [
			"import minify from \"@proctorio/hulk\";",
			"import { createRequire } from \"node:module\";",
			`import { minify__ } from ${JSON.stringify(pathToFileURL(join(SRC__, "index.js")).href)};`,
			`const samples = ${JSON.stringify(samples)};`,
			"console.log(JSON.stringify({",
			"\timported: import.meta.resolve(\"@proctorio/hulk\"),",
			"\trequired: createRequire(import.meta.url).resolve(\"@proctorio/hulk\"),",
			"\tsame: createRequire(import.meta.url)(\"@proctorio/hulk\").default === minify,",
			"\toutputs: samples.map(([content, type]) => [minify(content, type), minify__(content, type)])",
			"}));"
		].join("\n");
		const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
			cwd: CONSUMER__,
			encoding: "utf8",
			timeout: 60000,
			killSignal: "SIGKILL"
		});

		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		const { imported, required, same, outputs } = JSON.parse(result.stdout);

		// exports: "import" and "require" both reach the packed lib/index.js, and the two are one module
		expect({
			imported,
			required,
			same
		}).toEqual({
			imported: pathToFileURL(join(PACKED_LIB__, "index.js")).href,
			required: join(PACKED_LIB__, "index.js"),
			same: true
		});
		for (const [index, [packed, src]] of outputs.entries())
		{
			// premise: minify changed the sample
			expect(src).not.toBe(samples[index][0]);
			expect({
				sample: samples[index][1],
				packed
			}).toEqual({
				sample: samples[index][1],
				packed: src
			});
		}
	});
});

/**
 * @description Builds a temp directory's src/ into its lib/.
 * @param {string} dir - Directory holding src/.
 * @return {Array<string>} The files buildLib__ wrote.
 */
function buildIn(dir)
{
	return buildLib__({
		srcDir: join(dir, "src"),
		outDir: join(dir, "lib")
	});
}

describe("buildLib__", () =>
{
	let dir;

	beforeEach(() =>
	{
		dir = mkdtempSync(join(tmpdir(), "hulk-build-"));
		writeFileSync(join(dir, "package.json"), "{ \"type\": \"module\" }\n");
		mkdirSync(join(dir, "src", "nested"), { recursive: true });
	});

	afterEach(() =>
	{
		rmSync(dir, {
			recursive: true,
			force: true
		});
	});

	it("minifies every .js file, copies anything else byte for byte and drops what src/ no longer has", () =>
	{
		const bytes = Buffer.from(Array.from({ length: 256 }, (_, byte) => byte));
		writeFileSync(join(dir, "src", "a.js"), "// a\nexport const a = 1;\n");
		writeFileSync(join(dir, "src", "nested", "b.js"), "/**\n * c\n */\nexport const b = 2;\n");
		writeFileSync(join(dir, "src", "data.bin"), bytes);
		mkdirSync(join(dir, "lib"));
		writeFileSync(join(dir, "lib", "stale.js"), "// stale\n");

		expect(buildIn(dir).sort())
			.toEqual(["a.js", "data.bin", join("nested", "b.js")]);

		expect(filesUnder(join(dir, "lib"))).toEqual(["a.js", "data.bin", join("nested", "b.js")]);
		expect(read(join(dir, "lib"), "a.js")).toBe("export const a = 1;");
		expect(read(join(dir, "lib"), join("nested", "b.js"))).toBe("export const b = 2;");
		expect(readFileSync(join(dir, "lib", "data.bin"))).toEqual(bytes);
	});

	it("fails on a file that does not parse, naming it", () =>
	{
		writeFileSync(join(dir, "src", "a.js"), "export const = 1; // x\n");

		expect(() => buildIn(dir))
			.toThrow(`${join(dir, "lib", "a.js")} does not parse once minified`);
	});
});
