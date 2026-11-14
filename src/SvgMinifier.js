import { minifyCss__ } from "./CssMinifier.js";
import { minifyJs__ } from "./JsMinifier.js";
import { stripSvgComments__ } from "./MarkupScanners.js";
import { shortenSvgNumbers__ } from "./SvgNumbers.js";
import { afterNext__, doctypeEnd__, skipSpace__, stickyAt__ } from "./SvgSyntax.js";
import { MARK__, restoreVault__, vault__ } from "./Vault.js";

const SVG_NAMESPACE__ = "http://www.w3.org/2000/svg";
const XHTML_NAMESPACE__ = "http://www.w3.org/1999/xhtml";
const VERBATIM_CONTENT__ = new Set(["text", "tspan", "textPath", "title", "desc", "foreignObject", "script", "style"]);
const JS_TYPES__ = new Set(["text/javascript", "application/javascript", "text/ecmascript", "application/ecmascript"]);
const ASCII_SPACE__ = "\t\n\f\r ";
const COMMENT_DROPPABLE_AFTER__ = ">\t\n\r ";
const INERT_ELEMENTS__ = new Set([
	"svg", "g", "defs", "symbol", "use", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan",
	"textPath", "title", "desc", "metadata", "linearGradient", "radialGradient", "stop", "pattern", "clipPath", "mask",
	"marker", "image", "filter", "foreignObject", "switch", "view", "animate", "animateTransform", "animateMotion", "set", "mpath",
	"feBlend", "feColorMatrix", "feComponentTransfer", "feComposite", "feConvolveMatrix", "feDiffuseLighting",
	"feDisplacementMap", "feDistantLight", "feDropShadow", "feFlood", "feFuncA", "feFuncB", "feFuncG", "feFuncR",
	"feGaussianBlur", "feImage", "feMerge", "feMergeNode", "feMorphology", "feOffset", "fePointLight",
	"feSpecularLighting", "feSpotLight", "feTile", "feTurbulence"
]);
const NAME_START_NOT__ = "-.0123456789";

const NAME__ = new RegExp(`[^\\t\\n\\r "'&/<=>?!${MARK__}]+`, "uy");
const DOCTYPE__ = /<!doctype/iu;
const READABLE_VALUE__ = /attr|[&\\]/iu;
const XML_DECLARATION__ = /<\?xml[\t\n\r ?]/iuy;
const ASCII_UPPER__ = /[A-Z]+/gu;
const PAYLOAD_UNSAFE__ = /[&<]|\]\]>/u;

const UNBOUND__ = Object.freeze({ uri: "" });
const ROOT__ = Object.freeze({
	name: "",
	local: "",
	svg: false,
	defaultNamespace: null,
	preserve: false,
	textual: false,
	verbatim: false,
	declared: [],
	parent: null
});

/**
 * @description Gives a whitespace run the output main's stream rules give it when it stands alone.
 * @param {string} run - XML whitespace.
 * @return {string} One space for two or more characters, nothing for a single line break, else the run.
 */
function whitespaceRun__(run)
{
	if (run.length > 1) return " ";

	return run === "\n" || run === "\r" ? "" : run;
}

/**
 * @description Lowercases ASCII letters only.
 * @param {string} text - Text.
 * @return {string} The text with A-Z lowercased.
 */
function asciiLower__(text)
{
	return text.replaceAll(ASCII_UPPER__, letters => letters.toLowerCase());
}

/**
 * @description Strips leading and trailing ASCII whitespace.
 * @param {string} text - Text.
 * @return {string} The text without ASCII whitespace at either end.
 */
function trimAsciiSpace__(text)
{
	let start = 0;
	let end = text.length;

	while (start < end && ASCII_SPACE__.includes(text[start])) start++;
	while (end > start && ASCII_SPACE__.includes(text[end - 1])) end--;

	return text.slice(start, end);
}

/**
 * @description Stores text in the vault and emits its marker.
 * @param {Object} scan - Scanner state.
 * @param {string} text - Text to keep as it is.
 */
function emitVaulted__(scan, text)
{
	scan.out.push(vault__(scan.spans, text));
}

/**
 * @description Vaults a construct verbatim up to its terminator.
 * @param {Object} scan - Scanner state.
 * @param {number} start - Index of the construct's "<".
 * @param {string} terminator - Text that ends it.
 * @param {number} from - Where the terminator search starts.
 * @return {number} Index after the construct, or -1 when it is not terminated.
 */
function vaultUntil__(scan, start, terminator, from)
{
	const end = afterNext__(scan.content, terminator, from);

	if (end !== -1) emitVaulted__(scan, scan.content.slice(start, end));

	return end;
}

/**
 * @description Tells whether a range holds only characters XML 1.0 allows (no C0 control but tab, LF and CR, no lone surrogate).
 * @param {string} content - SVG.
 * @param {number} start - Start of the range.
 * @param {number} end - End of the range.
 * @return {boolean} True when every character is an XML Char.
 */
function xmlChars__(content, start, end)
{
	for (let index = start; index < end; index++)
	{
		const code = content.charCodeAt(index);

		if (code < 0x20 && code !== 0x09 && code !== 0x0A && code !== 0x0D) return false;
		if (code === 0xFFFE || code === 0xFFFF || (code >= 0xDC00 && code <= 0xDFFF)) return false;

		if (code >= 0xD800 && code <= 0xDBFF)
		{
			const low = content.charCodeAt(index + 1);

			if (!(low >= 0xDC00 && low <= 0xDFFF)) return false;
			index++;
		}
	}

	return true;
}

/**
 * @description Scans a comment, which must end at its first "--": exposed to the comment strip at the start or after ">" or XML whitespace, else vaulted.
 * @param {Object} scan - Scanner state.
 * @param {number} start - Index of "<!--".
 * @return {number} Index after the comment, or -1 when it is not a well-formed comment.
 */
function scanComment__(scan, start)
{
	const { content } = scan;
	const close = content.indexOf("--", start + 4);

	if (close === -1 || content[close + 2] !== ">") return -1;

	if (start === 0 || COMMENT_DROPPABLE_AFTER__.includes(content[start - 1])) scan.out.push(content.slice(start, close + 3));
	else emitVaulted__(scan, content.slice(start, close + 3));

	return close + 3;
}

/**
 * @description Scans a construct that starts with "<!": comment, CDATA section or DOCTYPE.
 * @param {Object} scan - Scanner state.
 * @param {number} start - Index of "<!".
 * @return {number} Index after the construct, or -1 when it is not one of those.
 */
function scanBang__(scan, start)
{
	const { content } = scan;

	if (content.startsWith("--", start + 2)) return scanComment__(scan, start);
	if (content.startsWith("[CDATA[", start + 2)) return vaultUntil__(scan, start, "]]>", start + 9);
	if (!content.startsWith("DOCTYPE", start + 2)) return -1;

	const end = doctypeEnd__(content, start + 9);

	if (end !== -1) emitVaulted__(scan, content.slice(start, end));

	return end;
}

/**
 * @description Reads one attribute of a start tag.
 * @param {string} content - SVG.
 * @param {number} index - Index of the attribute's name.
 * @return {?Object} Its name, quote, value and end, or null when it is not a well-formed XML attribute.
 */
function readAttribute__(content, index)
{
	const name = stickyAt__(NAME__, content, index);

	if (name === null) return null;

	const equals = skipSpace__(content, index + name[0].length);

	if (content[equals] !== "=") return null;

	const open = skipSpace__(content, equals + 1);
	const quote = content[open];

	if (quote !== "\"" && quote !== "'") return null;

	const close = content.indexOf(quote, open + 1);

	if (close === -1) return null;

	const value = content.slice(open + 1, close);

	if (value.includes("<")) return null;

	return {
		name: name[0],
		quote,
		value,
		end: close + 1
	};
}

/**
 * @description Reads the attributes of a start tag up to its ">" or "/>".
 * @param {string} content - SVG.
 * @param {number} index - Index just after the element name.
 * @return {?Object} The attributes, the whitespace before the close, the close and the tag's end; null when malformed.
 */
function readAttributes__(content, index)
{
	const attributes = [];
	const names = new Set();
	let at = index;

	for (;;)
	{
		const spaceEnd = skipSpace__(content, at);
		const close = content.startsWith("/>", spaceEnd) ? "/>" : content[spaceEnd];

		if (close === ">" || close === "/>")
		{
			return {
				attributes,
				trailing: content.slice(at, spaceEnd),
				close,
				end: spaceEnd + close.length
			};
		}

		const attribute = spaceEnd === at ? null : readAttribute__(content, spaceEnd);

		if (attribute === null || names.has(attribute.name)) return null;

		names.add(attribute.name);
		attributes.push(attribute);
		at = attribute.end;
	}
}

/**
 * @description Builds the scope of an element: its namespace, xml:space, whether its character data stays verbatim and whether it is inert.
 * @param {Object} scan - Scanner state; namespace prefixes the element declares are bound in it.
 * @param {string} name - Element name as written.
 * @param {Array<Object>} attributes - The element's attributes.
 * @return {Object} The element's frame.
 */
function openFrame__(scan, name, attributes)
{
	const parent = scan.top;
	const declared = [];
	let defaultNamespace = parent.defaultNamespace;
	let preserve = parent.preserve;

	for (const attribute of attributes)
	{
		if (attribute.name === "xmlns") defaultNamespace = attribute.value;
		if (attribute.name === "xml:space") preserve = attribute.value !== "default";

		if (attribute.name.startsWith("xmlns:"))
		{
			const prefix = attribute.name.slice(6);

			scan.prefixes.set(prefix, {
				uri: attribute.value,
				previous: scan.prefixes.get(prefix)
			});
			declared.push(prefix);
		}
	}

	const colon = name.indexOf(":");
	const lastColon = name.lastIndexOf(":");
	const local = name.slice(lastColon + 1);
	let namespace = defaultNamespace;

	if (colon !== -1) namespace = colon === lastColon ? (scan.prefixes.get(name.slice(0, colon)) || UNBOUND__).uri : "";

	const textual = parent.textual || VERBATIM_CONTENT__.has(local);
	const svg = namespace === SVG_NAMESPACE__ || namespace === null;

	return {
		name,
		local,
		svg,
		defaultNamespace,
		preserve,
		textual,
		verbatim: textual || preserve,
		inert: svg ? INERT_ELEMENTS__.has(local) : namespace !== XHTML_NAMESPACE__,
		declared,
		parent
	};
}

/**
 * @description Leaves an element's scope.
 * @param {Object} scan - Scanner state.
 * @param {Object} frame - The element's frame.
 */
function closeFrame__(scan, frame)
{
	for (const prefix of frame.declared) scan.prefixes.set(prefix, scan.prefixes.get(prefix).previous);
}

/**
 * @description Finds an attribute's value.
 * @param {Array<Object>} attributes - Attributes of a tag.
 * @param {string} name - Attribute name.
 * @return {?string} The value, or null when the attribute is absent.
 */
function attributeValue__(attributes, name)
{
	const found = attributes.find(attribute => attribute.name === name);

	return found ? found.value : null;
}

/**
 * @description Tells whether a name starts with "on" in any case, as event handler attributes do.
 * @param {string} name - Attribute name, or the value of an attributeName attribute.
 * @return {boolean} True when it may name an event handler.
 */
function handlerName__(name)
{
	return asciiLower__(trimAsciiSpace__(name)).startsWith("on");
}

/**
 * @description Tells whether an attribute lets script or CSS read attribute text: a handler, an animated handler, or a value with attr(), an escape or an entity.
 * @param {Object} attribute - Attribute as read from the tag.
 * @return {boolean} True when it may read other attributes.
 */
function readsAttributes__(attribute)
{
	return handlerName__(attribute.name) || READABLE_VALUE__.test(attribute.value) || (attribute.name === "attributeName" && handlerName__(attribute.value));
}

/**
 * @description Picks the minifier for a style or script element's payload, by its type.
 * @param {string} local - Element local name.
 * @param {Array<Object>} attributes - The element's attributes.
 * @return {?Function} The CSS or JS minifier, or null when the payload stays verbatim.
 */
function payloadMinifier__(local, attributes)
{
	const type = attributeValue__(attributes, "type");

	if (type !== null && type.includes("&")) return null;
	if (local === "style") return type === null || asciiLower__(type) === "text/css" ? minifyCss__ : null;
	if (local !== "script" || attributeValue__(attributes, "language") !== null) return null;

	return type === null || type === "" || JS_TYPES__.has(asciiLower__(trimAsciiSpace__(type))) ? minifyJs__ : null;
}

/**
 * @description Tells whether an end tag for an element starts at an index.
 * @param {string} content - SVG.
 * @param {number} index - Index to test.
 * @param {string} name - Element name as written.
 * @return {boolean} True when "</name", optional whitespace and ">" start there.
 */
function endTagAt__(content, index, name)
{
	return content.startsWith(`</${name}`, index) && content[skipSpace__(content, index + name.length + 2)] === ">";
}

/**
 * @description Minifies a style or script payload that is plain text or a single CDATA section.
 * @param {Object} scan - Scanner state.
 * @param {Object} frame - The element's frame.
 * @param {number} start - Index just after the start tag.
 * @param {Function} minifier - The CSS or JS minifier.
 * @return {number} Index of the end tag when the payload was minified, else the start (scanning goes on verbatim).
 */
function scanPayload__(scan, frame, start, minifier)
{
	const { content } = scan;
	const first = content.indexOf("<", start);

	if (first === -1) return start;

	if (endTagAt__(content, first, frame.name))
	{
		const body = content.slice(start, first);
		const minified = PAYLOAD_UNSAFE__.test(body) ? body : minifier(body);

		if (PAYLOAD_UNSAFE__.test(minified)) return start;

		emitVaulted__(scan, minified);

		return first;
	}

	if (skipSpace__(content, start) !== first || !content.startsWith("<![CDATA[", first)) return start;

	const close = content.indexOf("]]>", first + 9);
	const end = close === -1 ? -1 : skipSpace__(content, close + 3);

	if (end === -1 || !endTagAt__(content, end, frame.name)) return start;

	const minified = minifier(content.slice(first + 9, close));

	if (minified.includes("]]>")) return start;

	emitVaulted__(scan, `${minified.startsWith("#!") ? content.slice(start, first) : ""}<![CDATA[${minified}]]>`);

	return end;
}

/**
 * @description Scans a start tag: whitespace normalized, values vaulted (shortened numbers noted for the end), scope opened.
 * @param {Object} scan - Scanner state.
 * @param {number} start - Index of "<".
 * @return {number} Index after the tag (and after a minified payload), or -1 when the tag is malformed.
 */
function scanStartTag__(scan, start)
{
	const { content } = scan;
	const name = NAME_START_NOT__.includes(content[start + 1]) ? null : stickyAt__(NAME__, content, start + 1);
	const tag = name === null ? null : readAttributes__(content, start + 1 + name[0].length);

	if (tag === null) return -1;

	const frame = openFrame__(scan, name[0], tag.attributes);

	if (!frame.inert || tag.attributes.some(readsAttributes__)) scan.plain = false;

	scan.out.push("<", name[0]);

	for (const attribute of tag.attributes)
	{
		scan.out.push(" ", attribute.name, "=", attribute.quote, vault__(scan.spans, attribute.value), attribute.quote);

		if (frame.svg) scan.numbers.push([scan.spans.length - 1, shortenSvgNumbers__(frame.local, attribute.name, attribute.value)]);
	}

	scan.out.push(whitespaceRun__(tag.trailing), tag.close);

	if (tag.close === "/>")
	{
		closeFrame__(scan, frame);

		return tag.end;
	}

	scan.top = frame;

	const minifier = scan.conservative || frame.parent.textual || frame.preserve || !frame.svg ? null : payloadMinifier__(frame.local, tag.attributes);

	return minifier === null ? tag.end : scanPayload__(scan, frame, tag.end, minifier);
}

/**
 * @description Scans an end tag, which must close the innermost open element.
 * @param {Object} scan - Scanner state.
 * @param {number} start - Index of "</".
 * @return {number} Index after the tag, or -1 when it is malformed or unmatched.
 */
function scanEndTag__(scan, start)
{
	const { content } = scan;
	const name = stickyAt__(NAME__, content, start + 2);

	if (name === null || name[0] !== scan.top.name) return -1;

	const nameEnd = start + 2 + name[0].length;
	const end = skipSpace__(content, nameEnd);

	if (content[end] !== ">") return -1;

	scan.out.push("</", name[0], whitespaceRun__(content.slice(nameEnd, end)), ">");
	closeFrame__(scan, scan.top);
	scan.top = scan.top.parent;

	return end + 1;
}

/**
 * @description Scans character data between two markup constructs (or a document edge).
 * @param {Object} scan - Scanner state.
 * @param {number} start - Index where the text starts.
 * @param {number} end - Index where it ends.
 * @param {boolean} last - Whether it runs to the end of the document.
 */
function scanText__(scan, start, end, last)
{
	const text = scan.content.slice(start, end);

	if (scan.conservative || scan.top.verbatim || skipSpace__(scan.content, start) < end)
	{
		emitVaulted__(scan, text);
	}
	else if (start === 0 || last)
	{
		scan.out.push(whitespaceRun__(text));
	}
}

/**
 * @description Scans one markup construct.
 * @param {Object} scan - Scanner state.
 * @param {number} start - Index of its "<".
 * @return {number} Index after it, or -1 when the scanner cannot be sure of the rest of the document.
 */
function scanMarkup__(scan, start)
{
	const next = scan.content[start + 1];

	if (next === "!") return scanBang__(scan, start);
	if (next === "?")
	{
		if (stickyAt__(XML_DECLARATION__, scan.content, start) === null) scan.plain = false;

		return vaultUntil__(scan, start, "?>", start + 2);
	}

	return next === "/" ? scanEndTag__(scan, start) : scanStartTag__(scan, start);
}

/**
 * @description Tells whether an XML declaration, or another PI named xml, starts at or after an index (XML allows one only at the start).
 * @param {string} content - SVG.
 * @param {number} from - Index to search from.
 * @return {boolean} True when one is found.
 */
function declarationFrom__(content, from)
{
	for (let at = content.indexOf("<?", from); at !== -1; at = content.indexOf("<?", at + 2))
	{
		if (stickyAt__(XML_DECLARATION__, content, at) !== null) return true;
	}

	return false;
}

/**
 * @description Minifies SVG content; a document XML rejects stays as written, numbers change only where no CSS or script can read them.
 * @param {string} content - Original SVG content.
 * @return {string} Minified output of the given SVG content.
 */
function minifySvg__(content)
{
	if (!xmlChars__(content, 0, content.length) || declarationFrom__(content, 1)) return content;

	const conservative = DOCTYPE__.test(content);
	const scan = {
		content,
		spans: [],
		out: [],
		top: ROOT__,
		prefixes: new Map(),
		conservative,
		plain: !conservative,
		numbers: []
	};
	let at = 0;

	while (at < content.length)
	{
		const start = content.indexOf("<", at);
		const end = start === -1 ? content.length : start;

		if (end > at) scanText__(scan, at, end, start === -1);

		at = start === -1 ? content.length : scanMarkup__(scan, start);

		if (at === -1)
		{
			emitVaulted__(scan, content.slice(start));
			scan.plain = false;
			at = content.length;
		}
	}

	if (scan.plain) for (const [span, value] of scan.numbers) scan.spans[span] = value;

	return restoreVault__(scan.spans, stripSvgComments__(scan.out.join("")));
}

export { minifySvg__ };
