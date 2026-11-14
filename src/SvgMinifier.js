import { stripSvgComments__ } from "./MarkupScanners.js";

/**
 * @description Minifies SVG content.
 * @param {string} content - Original SVG content.
 * @return {string} Minified output of the given SVG content.
 */
function minifySvg__(content)
{
	const collapsed = content.replaceAll(/>\s+</gu, "><")
		.replaceAll(/\s\s+/gu, " ");
	const minified = stripSvgComments__(collapsed)
		.replaceAll(/(\r\n|\n|\r)/gum, "")
		.replaceAll(/\s*=\s*/gu, "=")
		.replaceAll(/(\d)\.0+(\D)/gu, "$1$2")
		.replaceAll(/(\d)\.(\d*?)0+(\D)/gu, "$1.$2$3")
		.replaceAll(/(\D)0\.(\d+)/gu, "$1.$2");

	return minified;
}

export { minifySvg__ };
