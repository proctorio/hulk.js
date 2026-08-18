// HTML void elements: the self-closing "/" before ">" is never meaningful for these (browsers
// treat "<img ... />" and "<img ...>" identically), unlike svg/mathml foreign content elements
// (e.g. <path/>, <circle/>), where the "/" is what tells the parser the element has no children.
const VOID_ELEMENTS__ = "area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr";

/**
 * @description Minifies HTML content.
 * @param {string} content - Original HTML content.
 * @return {string} Minified output of the given HTML content.
 */
function _minifiHtml__(content)
{
	const preservedBlocks = [];

	// Extract <pre> and <code> blocks.
	const placeholderHtml = content.replaceAll(
		/<(pre|code)(\b[^>]*)>[\s\S]*?<\/\1>/giu,
		match => 
		{
			const key = `__PRESERVE_BLOCK_${preservedBlocks.length}__`;
			preservedBlocks.push(match);
			
			return key;
		}
	);

	// Minify remaining HTML.
	let minified = placeholderHtml
		.replaceAll(/\r\n|\n|\t/giu, " ")

		// drop the self-closing "/" on void elements: always safe, regardless of attribute order
		.replaceAll(new RegExp(`(<(?:${VOID_ELEMENTS__})\\b[^>]*?)\\s*/>`, "giu"), "$1>")

		// don't strip quotes right before a "/": would get absorbed into the value otherwise
		.replaceAll(/(href|src)=('|")(\S+)('|")(?!\s*\/)/giu, "$1=$3")
		.replaceAll(/>\s+</giu, "><").trim()
		.replaceAll(/\s{2,}/giu, " ");

	// Repeat until no comments remain: nested/overlapping "<!--"/"-->" can otherwise survive a
	// single pass by re-forming across a deleted comment's boundary (CodeQL
	// js/incomplete-multi-character-sanitization, e.g. "<!<!---->-->-->" -> "<!-->-->" -> "").
	let previousMinified;
	do
	{
		previousMinified = minified;
		minified = minified.replaceAll(/<!--[\D\d]*?-->/giu, "");
	} while (minified !== previousMinified);

	minified = minified
		.replaceAll(/\s*=\s*/gu, "=")
		.replaceAll(/\s+>/gu, ">")
		.replaceAll(/<script\s+type=(["'])text\/javascript\1/giu, "<script")
		.replaceAll(/<style\s+type=(["'])text\/css\1/giu, "<style")
		.replaceAll(/\s+(checked|disabled|selected|readonly|required|autofocus|autoplay|controls|loop|muted)=(["'])\1\2/giu, " $1")
		.trim();

	// Restore preserved blocks.
	preservedBlocks.forEach((block, i) => 
	{
		minified = minified.replace(`__PRESERVE_BLOCK_${i}__`, block);
	});

	return minified;
}

/**
 * @description Minifies CSS content.
 * @param {string} content - Original CSS content.
 * @return {string} Minified output of the given CSS content.
 */
function _minifiCss__(content)
{
	const minified = content
		.replaceAll(/\/\*(?:(?!\*\/)[\s\S])*\*\/|[\r\n\t]+/gu, "")
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

/**
 * @description Minifies SVG content.
 * @param {string} content - Original SVG content.
 * @return {string} Minified output of the given SVG content.
 */
function _minifiSvg__(content)
{
	const minified = content.replaceAll(/>\s+</gu, "><")
		.replaceAll(/\s\s+/gu, " ")
		.replaceAll(/<![\t\n\r ]*(--([^-]|[\n\r]|-[^-])*--[\t\n\r ]*)>/gu, "")
		.replaceAll(/(\r\n|\n|\r)/gum, "")
		.replaceAll(/\s*=\s*/gu, "=")
		.replaceAll(/(\d)\.0+(\D)/gu, "$1$2")
		.replaceAll(/(\d)\.(\d*?)0+(\D)/gu, "$1.$2$3")
		.replaceAll(/(\D)0\.(\d+)/gu, "$1.$2");

	return minified;
}

/**
 * @description Minifies JS content.
 * @param {string} content - Original JS content.
 * @return {string} Minified output of the given JS content.
 */
function _minifiJs__(content)
{
	const minified = content.replaceAll(/(^\s*|^)\/\*[\S\s]*?\*\/|(^\s*|^)\/\/.*$/gum, "$1")
		.replaceAll(/\s+$/gum, "")
		.trim();

	return minified;
}

/**
 * @description Minifies JSON content.
 * @param {string} content - Original JSON content.
 * @return {string} Minified output of the given JSON content.
 */
function _minifiJson__(content)
{
	try
	{
		return JSON.stringify(JSON.parse(content));
	} 
	catch
	{
		return content;
	}
}

/**
 * @description Function that minifies content of HTML, CSS, SVG, JS, and JSON files. A
 * leading UTF-8 BOM (U+FEFF) is always stripped before minification.
 * @param {string} content - Content to minify.
 * @param {string} extension - Type of file (html, css, svg, js, json).
 * @return {string} Return minified content.
 */
const minify__ = (content, extension) =>
{
	if (typeof content !== "string") return "";

	// A leading U+FEFF is an encoding artifact (byte order mark), not content: strip it so
	// callers that prepend banners cannot push it mid-file (where it invalidates the first
	// css rule or html tag) and so JSON.parse does not reject the input.
	const cleanContent = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
	
	let minifiedContent = cleanContent;

	switch (extension)
	{
		case "html":
			minifiedContent = _minifiHtml__(cleanContent);
			break;
		case "css":
			minifiedContent = _minifiCss__(cleanContent);
			break;
		case "svg":
			minifiedContent = _minifiSvg__(cleanContent);
			break;
		case "js":
			minifiedContent = _minifiJs__(cleanContent);
			break;
		case "json":
			minifiedContent = _minifiJson__(cleanContent);
			break;
		default:
			console.warn("Extension provided is not supported. Returning same content.");
	}
	
	return minifiedContent;
};

export default minify__;
export { minify__ };