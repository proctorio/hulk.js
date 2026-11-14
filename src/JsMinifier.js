import { stripJsComments__ } from "./JsComments.js";

/**
 * @description Minifies JS content.
 * @param {string} content - Original JS content.
 * @return {string} Minified output of the given JS content.
 */
function minifyJs__(content)
{
	const minified = stripJsComments__(content)
		.replaceAll(/\s+$/gum, "")
		.trim();

	return minified;
}

export { minifyJs__ };
