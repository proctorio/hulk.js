import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import minify__ from "../src/index.js";

/**
 * @description Lists the files under a directory.
 * @param {string} root - Directory to walk.
 * @param {string} [prefix] - Path of root relative to the walk's start.
 * @return {Array<string>} Relative file paths, in directory order.
 */
function _listFiles__(root, prefix = "")
{
	return readdirSync(join(root, prefix), { withFileTypes: true })
		.flatMap(entry => (entry.isDirectory() ? _listFiles__(root, join(prefix, entry.name)) : [join(prefix, entry.name)]));
}

/**
 * @description Builds the published lib/ from src/: a copy in which every .js file has been through hulk's own JS
 * minifier (comments removed), anything else as is. Each minified file must still parse (node --check), or the build
 * fails.
 * @param {{srcDir: string, outDir: string}} dirs - Source directory and output directory (replaced).
 * @return {Array<string>} The files written, relative to outDir.
 */
function buildLib__({ srcDir, outDir })
{
	rmSync(outDir, {
		recursive: true,
		force: true
	});
	const files = _listFiles__(srcDir);

	for (const file of files)
	{
		const source = join(srcDir, file);
		const target = join(outDir, file);
		mkdirSync(dirname(target), { recursive: true });
		if (file.endsWith(".js"))
		{
			writeFileSync(target, minify__(readFileSync(source, "utf8"), "js"));
			const check = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
			if (check.status !== 0)
			{
				throw new Error(`${target} does not parse once minified:\n${check.error?.message ?? check.stderr}`);
			}
		}
		else
		{
			copyFileSync(source, target);
		}
	}

	return files;
}

export { buildLib__ };
