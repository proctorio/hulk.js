import { stripCssComments__ } from "./MarkupScanners.js";

/**
 * @description Minifies CSS content.
 * @param {string} content - Original CSS content.
 * @return {string} Minified output of the given CSS content.
 */
function minifyCss__(content)
{
	const minified = stripCssComments__(content)
		.replaceAll(/[\r\n\t]+/gu, "")
		.replaceAll(/ {2,}/gu, " ")
		.replaceAll(/ ([{:}]) /gu, "$1")
		.replaceAll(/([;,]) /gu, "$1")
		.replaceAll(" !", "!")
		.replaceAll(/(\s|:)0(?:px|em|rem|vh|vw|vmin|vmax|cm|mm|in|pt|pc|ex|ch)/giu, "$10")
		.replaceAll(/(\D)0\.(\d+)/gu, "$1.$2")
		.replaceAll(";}", "}")
		.replaceAll(/#([0-9a-fA-F])\1([0-9a-fA-F])\2([0-9a-fA-F])\3/gu, "#$1$2$3")
		.replaceAll(": ", ":")
		.replaceAll(" {", "{")
		.replaceAll(/\{\s+/gu, "{")
		.replaceAll(/\s+\}/gu, "}");

	return minified;
}

export { minifyCss__ };
