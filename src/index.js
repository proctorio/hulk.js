import { minifyCss__ } from "./CssMinifier.js";
import { minifyHtml__ } from "./HtmlMinifier.js";
import { minifyJs__ } from "./JsMinifier.js";
import { minifySvg__ } from "./SvgMinifier.js";

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
 * leading UTF-8 BOM (U+FEFF) is always stripped before minification, and a result that would start
 * with one that the stripped content did not (a minifier removed what stood before it) is not used:
 * the stripped content is returned as it was.
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
			minifiedContent = minifyHtml__(cleanContent);
			break;
		case "css":
			minifiedContent = minifyCss__(cleanContent);
			break;
		case "svg":
			minifiedContent = minifySvg__(cleanContent);
			break;
		case "js":
			minifiedContent = minifyJs__(cleanContent);
			break;
		case "json":
			minifiedContent = _minifiJson__(cleanContent);
			break;
		default:
			console.warn("Extension provided is not supported. Returning same content.");
	}
	
	return minifiedContent.charCodeAt(0) === 0xFEFF && cleanContent.charCodeAt(0) !== 0xFEFF ? cleanContent : minifiedContent;
};

export default minify__;
export { minify__ };