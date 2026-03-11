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
		.replaceAll(/(href|src)=('|")(\S+)('|")/giu, "$1=$3")
		.replaceAll(/>\s+</giu, "><").trim()
		.replaceAll(/\s{2,}/giu, " ")
		.replaceAll(/<!--[\D\d]*?-->/giu, "")
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
 * @description Function that minifies content of HTML, CSS, SVG, JS, and JSON files.
 * @param {string} content - Content to minify.
 * @param {string} extension - Type of file (html, css, svg, js, json).
 * @return {string} Return minified content.
 */
const minify__ = (content, extension) =>
{
	if (typeof content !== "string") return "";
	
	let minifiedContent = content;

	switch (extension)
	{
		case "html":
			minifiedContent = _minifiHtml__(content);
			break;
		case "css":
			minifiedContent = _minifiCss__(content);
			break;
		case "svg":
			minifiedContent = _minifiSvg__(content);
			break;
		case "js":
			minifiedContent = _minifiJs__(content);
			break;
		case "json":
			minifiedContent = _minifiJson__(content);
			break;
		default:
			console.warn("Extension provided is not supported. Returning same content.");
	}
	
	return minifiedContent;
};

export default minify__;
export { minify__ };