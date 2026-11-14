import { minifyCss__ } from "./CssMinifier.js";
import { asciiLower__, attributeValue__, caseless__, searchFrom__, trimHtmlSpace__ } from "./HtmlTags.js";
import { minifyJs__ } from "./JsMinifier.js";

const DELIMITER__ = "[\\t\\n\\f\\r />]";
const RAW_TEXT_NAMES__ = ["style", "xmp", "iframe", "noembed", "noframes", "noscript", "textarea", "title"];
const JS_TYPES__ = new Set(["text/javascript", "application/javascript", "text/ecmascript", "application/ecmascript"]);
const END_TAGS__ = new Map(RAW_TEXT_NAMES__.map(name => [name, new RegExp(`</${caseless__(name)}${DELIMITER__}`, "gu")]));
const SCRIPT_DATA__ = new RegExp(`<!--|</${caseless__("script")}${DELIMITER__}`, "gu");
const SCRIPT_ESCAPED__ = new RegExp(`-->|</?${caseless__("script")}${DELIMITER__}`, "gu");
const SCRIPT_DOUBLE__ = new RegExp(`-->|</${caseless__("script")}${DELIMITER__}`, "gu");
const SCRIPT_CLOSE__ = new RegExp(`</${caseless__("script")}`, "u");
const STYLE_CLOSE__ = new RegExp(`</${caseless__("style")}`, "u");

/**
 * @description Runs a global regex from an index.
 * @param {RegExp} regex - Global regex.
 * @param {string} text - Text to search.
 * @param {number} index - Where the search starts.
 * @return {?Array} The match, or null.
 */
function execFrom__(regex, text, index)
{
	regex.lastIndex = index;

	return regex.exec(text);
}

/**
 * @description Finds the end tag that closes script data, through the tokenizer's escaped and double-escaped states.
 * @param {string} text - HTML.
 * @param {number} from - Index just past the script start tag.
 * @return {number} Index of the closing "</script", or -1 when the script runs to the end of the text.
 */
function scriptDataEnd__(text, from)
{
	let regex = SCRIPT_DATA__;
	let match = execFrom__(regex, text, from);

	while (match !== null)
	{
		const token = match[0];
		let index = match.index + token.length;

		if (token === "<!--")
		{
			regex = SCRIPT_ESCAPED__;
			index = match.index + 2;
		}
		else if (token === "-->") regex = SCRIPT_DATA__;
		else if (token[1] !== "/") regex = SCRIPT_DOUBLE__;
		else if (regex === SCRIPT_DOUBLE__) regex = SCRIPT_ESCAPED__;
		else return match.index;

		match = execFrom__(regex, text, index);
	}

	return -1;
}

/**
 * @description Tells whether an HTML element's content is script data, raw text or RCDATA.
 * @param {string} name - ASCII-lowercased element name.
 * @return {boolean} True for script, style, xmp, iframe, noembed, noframes, noscript, textarea and title.
 */
function isTextElement__(name)
{
	return name === "script" || END_TAGS__.has(name);
}

/**
 * @description Finds the end tag that closes a script, raw text or RCDATA element.
 * @param {string} text - HTML.
 * @param {Object} tag - The element's start tag.
 * @return {number} Index of the end tag's "<", or -1 when the element runs to the end of the text.
 */
function textEnd__(text, tag)
{
	return tag.name === "script" ? scriptDataEnd__(text, tag.end) : searchFrom__(END_TAGS__.get(tag.name), text, tag.end);
}

/**
 * @description Tells whether a style element's content is CSS that browsers apply.
 * @param {string} text - HTML.
 * @param {Object} tag - Style start tag.
 * @return {boolean} True with no type attribute or a single type of text/css.
 */
function styleEligible__(text, tag)
{
	return tag.types === 0 || (tag.types === 1 && asciiLower__(attributeValue__(text, tag.type)) === "text/css");
}

/**
 * @description Tells whether a script element's content is JavaScript that browsers run.
 * @param {string} text - HTML.
 * @param {Object} tag - Script start tag.
 * @return {boolean} True without a language attribute and with no type, an empty type, a JavaScript type, or module.
 */
function scriptEligible__(text, tag)
{
	if (tag.language || tag.types > 1) return false;
	if (tag.types === 0) return true;

	const type = attributeValue__(text, tag.type);

	return type === "" || JS_TYPES__.has(asciiLower__(trimHtmlSpace__(type))) || asciiLower__(type) === "module";
}

/**
 * @description Minifies a script or style payload when browsers will read it as JavaScript or CSS, and when the minified
 * text cannot end the element early.
 * @param {string} text - HTML.
 * @param {Object} tag - Start tag of the element.
 * @param {string} content - The element's content.
 * @param {boolean} gated - Whether the document holds markup that can make the parser ignore a script or style start tag.
 * @return {string} The minified payload, or the content verbatim.
 */
function payload__(text, tag, content, gated)
{
	if (gated || tag.name === "textarea") return content;
	if (tag.name === "style")
	{
		const css = styleEligible__(text, tag) ? minifyCss__(content) : content;

		return STYLE_CLOSE__.test(css) ? content : css;
	}

	if (!scriptEligible__(text, tag) || content.includes("<!--")) return content;

	const js = minifyJs__(content);

	return SCRIPT_CLOSE__.test(js) || js.includes("<!--") ? content : js;
}

export { isTextElement__, payload__, textEnd__ };
