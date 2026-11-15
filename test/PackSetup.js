import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT__ = fileURLToPath(new URL("..", import.meta.url));
const CONSUMER__ = join(ROOT__, ".test_output");
const PACK__ = join(CONSUMER__, "pack");
const PACKAGE__ = join(CONSUMER__, "node_modules", "@proctorio", "hulk");

/**
 * @description Runs a command in the repo and fails with its output when it does not exit 0.
 * @param {string} command - Executable.
 * @param {Array<string>} args - Arguments.
 * @return {void}
 */
function _run__(command, args)
{
	const result = spawnSync(command, args, {
		cwd: ROOT__,
		encoding: "utf8",
		timeout: 120000,
		killSignal: "SIGKILL"
	});
	if (result.status !== 0)
	{
		const how = result.error?.message ?? result.signal ?? result.status;

		throw new Error(`${command} ${args.join(" ")} failed (${how}):\n${result.stdout}\n${result.stderr}`);
	}
}

/**
 * @description Removes a file or directory tree, if there is one.
 * @param {string} path - What to remove.
 * @return {void}
 */
function _remove__(path)
{
	rmSync(path, {
		recursive: true,
		force: true
	});
}

/**
 * @description Global setup of the "lib" project: packs hulk the way a release does, from a tree with no lib/ (so the
 * prepack script's build is what produces it), and installs the tarball's contents in .test_output/, which is set up
 * as a consumer project. The package sits under a node_modules directory, so vitest hands it to Node as is.
 * @return {void}
 */
export default function setup()
{
	_remove__(join(ROOT__, "lib"));
	_remove__(PACK__);
	_remove__(PACKAGE__);
	mkdirSync(PACK__, { recursive: true });
	mkdirSync(PACKAGE__, { recursive: true });

	// A project of its own: from a directory inside this repo, Node resolves "@proctorio/hulk" to the repo itself
	// (package self-reference), never reaching node_modules.
	writeFileSync(join(CONSUMER__, "package.json"), "{ \"private\": true }\n");

	_run__("npm", ["pack", "--pack-destination", PACK__]);
	const tarballs = readdirSync(PACK__);
	if (tarballs.length !== 1)
	{
		throw new Error(`npm pack left ${JSON.stringify(tarballs)} in ${PACK__}, not one tarball`);
	}
	_run__("tar", ["-xzf", join(PACK__, tarballs[0]), "-C", PACKAGE__, "--strip-components=1"]);
	_remove__(PACK__);
}
