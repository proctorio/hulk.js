import { fileURLToPath } from "node:url";
import { buildLib__ } from "./BuildLib.js";

// npm run build (and so npm pack and npm publish, through prepack): src/ into lib/, comments stripped.
buildLib__({
	srcDir: fileURLToPath(new URL("../src", import.meta.url)),
	outDir: fileURLToPath(new URL("../lib", import.meta.url))
});
