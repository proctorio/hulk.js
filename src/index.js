/**
 * @description Minifies HTML content.
 * @param {string} content - Original HTML content.
 * @return {string} Minified output of the given HTML content.
 */
function _minifiHtml__(content)
{
	const preservedBlocks = [];

	// Extract <pre> and <code> blocks.
	const placeholderHtml = content.replace(
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
		.replace(/\r\n|\n|\t/giu, " ")
		.replace(/(href|src)=('|")(\S+)('|")/giu, "$1=$3")
		.replace(/>\s+</giu, "><").trim()
		.replace(/\s{2,}/giu, " ")
		.replace(/<!--[\D\d]*?-->/giu, "")
		.replace(/\s*=\s*/gu, "=")
		.replace(/\s+>/gu, ">")
		.replace(/<script\s+type=(["'])text\/javascript\1/giu, "<script")
		.replace(/<style\s+type=(["'])text\/css\1/giu, "<style")
		.replace(/\s+(checked|disabled|selected|readonly|required|autofocus|autoplay|controls|loop|muted)=(["'])\1\2/giu, " $1")
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
		.replace(/\/\*(?:(?!\*\/)[\s\S])*\*\/|[\r\n\t]+/gu, "")
		.replace(/ {2,}/gu, " ")
		.replace(/ ([{:}]) /gu, "$1")
		.replace(/([;,]) /gu, "$1")
		.replace(/ !/gu, "!")
		.replace(/(\s|:)0(?:px|em|rem|vh|vw|vmin|vmax|cm|mm|in|pt|pc|ex|ch)/giu, "$10")
		.replace(/(\D)0\.(\d+)/gu, "$1.$2")
		.replace(/;\}/gu, "}")
		.replace(/#([0-9a-fA-F])\1([0-9a-fA-F])\2([0-9a-fA-F])\3/gu, "#$1$2$3")
		.replace(/: /gu, ":")
		.replace(/ \{/gu, "{")
		.replace(/\{\s+/gu, "{")
		.replace(/\s+\}/gu, "}");

	return minified;
}

/**
 * @description Minifies SVG content.
 * @param {string} content - Original SVG content.
 * @return {string} Minified output of the given SVG content.
 */
function _minifiSvg__(content)
{
	const minified = content.replace(/>\s+</gu, "><")
		.replaceAll(/\s\s+/gu, " ")
		.replace(/<![\t\n\r ]*(--([^-]|[\n\r]|-[^-])*--[\t\n\r ]*)>/gu, "")
		.replace(/(\r\n|\n|\r)/gum, "")
		.replace(/\s*=\s*/gu, "=")
		.replace(/(\d)\.0+(\D)/gu, "$1$2")
		.replace(/(\d)\.(\d*?)0+(\D)/gu, "$1.$2$3")
		.replace(/(\D)0\.(\d+)/gu, "$1.$2");

	return minified;
}

/**
 * @description Minifies JS content.
 * @param {string} content - Original JS content.
 * @return {string} Minified output of the given JS content.
 */
function _minifiJs__(content)
{
	const minified = content.replace(/(^\s*|^)\/\*[\S\s]*?\*\/|(^\s*|^)\/\/.*$/gum, "$1")
		.replace(/\s+$/gum, "")
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
	catch (error)
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