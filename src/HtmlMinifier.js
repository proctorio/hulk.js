import { isTextElement__, payload__, textEnd__ } from "./HtmlPayload.js";
import { cachedSearch__, caseless__, collapseSpace__, escapeMarks__, isAsciiAlpha__, readTag__, tagSource__, tagText__, trimHtmlSpace__ } from "./HtmlTags.js";
import { stripHtmlCommentsOnce__ } from "./MarkupScanners.js";
import { MARK__, restoreVault__, vault__ } from "./Vault.js";

const TEXT__ = 0;
const START__ = 1;
const END__ = 2;
const COMMENT__ = 3;
const BOGUS__ = 4;
const CDATA__ = 5;

const GATE__ = new RegExp(`<(?:${["select", "frameset", "noscript", "col"].map(caseless__).join("|")})`, "u");
const HIDDEN_STATE__ = new RegExp(`<(?:!--|(?:${["script", "style", "xmp", "iframe", "noembed", "noframes", "noscript", "textarea", "title", "plaintext", "svg", "math"].map(caseless__).join("|")})[\\t\\n\\f\\r />])`, "u");
const BLOCK_NAMES__ = new Set(["pre", "code", "listing"]);
const VAULTED_ELEMENTS__ = new Set(["script", "style", "textarea"]);
const FOREIGN_ROOTS__ = new Set(["svg", "math"]);
const INTEGRATION_POINTS__ = new Set(["foreignobject", "desc", "title", "mi", "mo", "mn", "ms", "mtext", "annotation-xml"]);
const FOREIGN_RAW__ = new Set(["script", "style"]);
const BREAKOUT__ = new Set([
	"b", "big", "blockquote", "body", "br", "center", "code", "dd", "div", "dl", "dt", "em", "embed", "h1", "h2", "h3", "h4", "h5", "h6", "head", "hr",
	"i", "img", "li", "listing", "menu", "meta", "nobr", "ol", "p", "pre", "ruby", "s", "small", "span", "strong", "strike", "sub", "sup", "table", "tt",
	"u", "ul", "var"
]);
const HANDLERS__ = [null, startTag__, endTag__, comment__, bogus__, cdata__];

/**
 * @description Moves the scan past a construct.
 * @param {Object} state - Scanner state.
 * @param {number} end - Index just past the construct.
 * @return {void}
 */
function advance__(state, end)
{
	state.index = end;
	state.textStart = end;
}

/**
 * @description Adds text to the output unless a preserved block is open, whose source is vaulted whole when it closes.
 * @param {Object} state - Scanner state.
 * @param {string} output - Text for the vaulted stream.
 * @return {void}
 */
function emit__(state, output)
{
	if (state.block === null) state.parts.push(output);
}

/**
 * @description Adds a tag in its minified form to the output, unless a preserved block is open.
 * @param {Object} state - Scanner state.
 * @param {Object} tag - Complete tag.
 * @param {boolean} html - Whether the tag is in HTML content rather than foreign content.
 * @return {void}
 */
function emitTag__(state, tag, html)
{
	if (state.block === null) state.parts.push(tagText__(state, tag, html));
}

/**
 * @description Vaults the rest of the document verbatim and ends the scan, from a tag after which the parser's state is
 * not certain, or from a tag that runs to the end of the text.
 * @param {Object} state - Scanner state.
 * @param {number} open - Index of the tag's "<".
 * @return {void}
 */
function latch__(state, open)
{
	const { text, spans, block } = state;

	state.parts.push(block === null ? `<${vault__(spans, text.slice(open + 1))}` : vault__(spans, text.slice(block.start)));
	state.block = null;
	state.done = true;
	advance__(state, text.length);
}

/**
 * @description Adds the pending text run to the output.
 * @param {Object} state - Scanner state.
 * @param {number} end - Index where the run ends.
 * @return {void}
 */
function flush__(state, end)
{
	const { text, textStart } = state;

	if (state.block !== null || end <= textStart) return;

	state.parts.push(state.foreignRaw > 0 ? vault__(state.spans, text.slice(textStart, end)) : escapeMarks__(state, textStart, end));
}

/**
 * @description Updates the integration point and foreign script or style counts for a foreign element.
 * @param {Object} state - Scanner state.
 * @param {string} name - ASCII-lowercased element name.
 * @param {number} step - 1 when the element opens, -1 when it closes.
 * @return {void}
 */
function count__(state, name, step)
{
	if (INTEGRATION_POINTS__.has(name)) state.integration += step;
	if (FOREIGN_RAW__.has(name)) state.foreignRaw += step;
}

/**
 * @description Opens a foreign element.
 * @param {Object} state - Scanner state.
 * @param {string} name - ASCII-lowercased element name.
 * @return {void}
 */
function push__(state, name)
{
	state.foreign.push(name);
	count__(state, name, 1);
}

/**
 * @description Closes foreign elements down to a stack depth.
 * @param {Object} state - Scanner state.
 * @param {number} depth - Number of foreign elements left open.
 * @return {void}
 */
function popTo__(state, depth)
{
	while (state.foreign.length > depth) count__(state, state.foreign.pop(), -1);
}

/**
 * @description Adds a raw text, RCDATA or script element to the output: script, style and textarea as one tag-like
 * marker, the others as tags around their vaulted content.
 * @param {Object} state - Scanner state.
 * @param {Object} tag - Start tag.
 * @param {string} content - The element's content.
 * @param {?Object} endTag - Complete end tag, or null when the element runs to the end of the text.
 * @return {void}
 */
function emitElement__(state, tag, content, endTag)
{
	const { spans, parts } = state;

	if (VAULTED_ELEMENTS__.has(tag.name))
	{
		const element = tagSource__(state, tag) + payload__(state.text, tag, content, state.gated) + (endTag === null ? "" : tagSource__(state, endTag));
		const tail = endTag === null ? "" : ">";

		parts.push(`<${vault__(spans, element.slice(1, element.length - tail.length))}${tail}`);

		return;
	}

	parts.push(tagText__(state, tag, true));

	if (content !== "") parts.push(vault__(spans, content));
	if (endTag !== null) parts.push(tagText__(state, endTag, true));
}

/**
 * @description Handles a script, raw text or RCDATA element, whose content runs to its end tag.
 * @param {Object} state - Scanner state.
 * @param {Object} tag - Start tag.
 * @return {void}
 */
function textElement__(state, tag)
{
	const { text } = state;
	const close = textEnd__(text, tag);

	if (state.gated && HIDDEN_STATE__.test(text.slice(tag.end, close === -1 ? text.length : close)))
	{
		latch__(state, tag.start);

		return;
	}

	const endTag = close === -1 ? null : readTag__(text, close, true);
	const complete = endTag !== null && endTag.end !== -1;

	if (state.block === null) emitElement__(state, tag, text.slice(tag.end, close === -1 ? text.length : close), complete ? endTag : null);

	if (complete) advance__(state, endTag.end);
	else if (close === -1)
	{
		state.done = true;
		advance__(state, text.length);
	}
	else latch__(state, close);
}

/**
 * @description Handles a plaintext element, which holds the rest of the document as text.
 * @param {Object} state - Scanner state.
 * @param {Object} tag - Start tag.
 * @return {void}
 */
function plaintext__(state, tag)
{
	const { text } = state;

	emitTag__(state, tag, true);

	if (tag.end < text.length) emit__(state, vault__(state.spans, text.slice(tag.end)));

	state.done = true;
	advance__(state, text.length);
}

/**
 * @description Handles a start tag in HTML content.
 * @param {Object} state - Scanner state.
 * @param {Object} tag - Complete start tag.
 * @return {void}
 */
function htmlStart__(state, tag)
{
	const { name } = tag;
	const { block } = state;

	if (BLOCK_NAMES__.has(name))
	{
		if (block === null)
		{
			state.block = {
				name,
				depth: 1,
				start: tag.start
			};
		}
		else if (block.name === name) block.depth++;

		advance__(state, tag.end);
	}
	else if (isTextElement__(name)) textElement__(state, tag);
	else if (name === "plaintext") plaintext__(state, tag);
	else
	{
		emitTag__(state, tag, true);

		if (FOREIGN_ROOTS__.has(name) && !tag.selfClosing) push__(state, name);

		advance__(state, tag.end);
	}
}

/**
 * @description Handles a start tag in foreign content.
 * @param {Object} state - Scanner state.
 * @param {Object} tag - Complete start tag.
 * @return {void}
 */
function foreignStart__(state, tag)
{
	if (state.integration > 0) latch__(state, tag.start);
	else if (BREAKOUT__.has(tag.name) || (tag.name === "font" && tag.fontBreak))
	{
		popTo__(state, 0);
		htmlStart__(state, tag);
	}
	else
	{
		emitTag__(state, tag, false);

		if (!tag.selfClosing) push__(state, tag.name);

		advance__(state, tag.end);
	}
}

/**
 * @description Handles an end tag in HTML content, closing a preserved block when it matches.
 * @param {Object} state - Scanner state.
 * @param {Object} tag - Complete end tag.
 * @return {void}
 */
function htmlEnd__(state, tag)
{
	const { block } = state;

	if (block !== null && block.name === tag.name)
	{
		block.depth--;

		if (block.depth === 0)
		{
			state.block = null;
			state.parts.push(vault__(state.spans, state.text.slice(block.start, tag.end)));
		}
	}
	else emitTag__(state, tag, true);

	advance__(state, tag.end);
}

/**
 * @description Handles an end tag in foreign content.
 * @param {Object} state - Scanner state.
 * @param {Object} tag - Complete end tag.
 * @return {void}
 */
function foreignEnd__(state, tag)
{
	const depth = state.foreign.lastIndexOf(tag.name);

	if (tag.name === "br" || tag.name === "p")
	{
		if (state.integration > 0) latch__(state, tag.start);
		else
		{
			popTo__(state, 0);
			htmlEnd__(state, tag);
		}
	}
	else if (depth === -1) latch__(state, tag.start);
	else
	{
		popTo__(state, depth);
		emitTag__(state, tag, false);
		advance__(state, tag.end);
	}
}

/**
 * @description Handles a start tag.
 * @param {Object} state - Scanner state.
 * @param {number} open - Index of its "<".
 * @return {void}
 */
function startTag__(state, open)
{
	const tag = readTag__(state.text, open, false);

	if (tag.end === -1) latch__(state, open);
	else if (state.foreign.length > 0) foreignStart__(state, tag);
	else htmlStart__(state, tag);
}

/**
 * @description Handles an end tag.
 * @param {Object} state - Scanner state.
 * @param {number} open - Index of its "<".
 * @return {void}
 */
function endTag__(state, open)
{
	const tag = readTag__(state.text, open, true);

	if (tag.end === -1) latch__(state, open);
	else if (state.foreign.length > 0) foreignEnd__(state, tag);
	else htmlEnd__(state, tag);
}

/**
 * @description Finds where a comment ends: "<!-->", "<!--->", the first "-->" or "--!>", or the end of the text.
 * @param {Object} state - Scanner state.
 * @param {number} open - Index of its "<!--".
 * @return {number} Index just past the comment.
 */
function commentEnd__(state, open)
{
	const { text } = state;
	const close = state.nextClose(open + 4);
	const bang = state.nextBang(open + 4);

	if (text.startsWith("<!-->", open)) return open + 5;
	if (text.startsWith("<!--->", open)) return open + 6;
	if (close === -1 && bang === -1) return text.length;
	if (bang === -1 || (close !== -1 && close < bang)) return close + 3;

	return bang + 4;
}

/**
 * @description Passes a comment through for the comment loop.
 * @param {Object} state - Scanner state.
 * @param {number} open - Index of its "<!--".
 * @return {void}
 */
function comment__(state, open)
{
	const end = commentEnd__(state, open);

	if (state.block === null) state.parts.push(escapeMarks__(state, open, end));

	advance__(state, end);
}

/**
 * @description Passes a bogus comment or DOCTYPE through, up to its first ">".
 * @param {Object} state - Scanner state.
 * @param {number} open - Index of its "<".
 * @return {void}
 */
function bogus__(state, open)
{
	const close = state.nextGt(open + 2);
	const end = close === -1 ? state.text.length : close + 1;

	if (state.block === null) state.parts.push(escapeMarks__(state, open, end));

	advance__(state, end);
}

/**
 * @description Vaults a CDATA section in foreign content.
 * @param {Object} state - Scanner state.
 * @param {number} open - Index of its "<![CDATA[".
 * @return {void}
 */
function cdata__(state, open)
{
	const { text } = state;
	const close = text.indexOf("]]>", open + 9);
	const end = close === -1 ? text.length : close + 3;

	if (state.integration > 0)
	{
		latch__(state, open);

		return;
	}

	emit__(state, vault__(state.spans, text.slice(open, end)));
	advance__(state, end);
}

/**
 * @description Classifies what a "<" starts.
 * @param {Object} state - Scanner state.
 * @param {number} open - Index of the "<".
 * @return {number} START__, END__, COMMENT__, BOGUS__, CDATA__, or TEXT__ for a "<" that is text.
 */
function kind__(state, open)
{
	const { text } = state;
	const next = text[open + 1];

	if (isAsciiAlpha__(next)) return START__;
	if (next === "/")
	{
		if (isAsciiAlpha__(text[open + 2])) return END__;

		return open + 2 < text.length ? BOGUS__ : TEXT__;
	}

	if (next === "?") return BOGUS__;
	if (next !== "!") return TEXT__;
	if (text.startsWith("<!--", open)) return COMMENT__;

	return state.foreign.length > 0 && text.startsWith("<![CDATA[", open) ? CDATA__ : BOGUS__;
}

/**
 * @description Scans HTML in document order, vaulting what must stay byte-exact.
 * @param {string} text - HTML.
 * @return {Object} The scanner state: parts of the vaulted text and the vault's spans.
 */
function scan__(text)
{
	const state = {
		text,
		spans: [],
		parts: [],
		foreign: [],
		integration: 0,
		foreignRaw: 0,
		block: null,
		done: false,
		gated: GATE__.test(text),
		index: 0,
		textStart: 0,
		nextMark: cachedSearch__(index => text.indexOf(MARK__, index)),
		nextClose: cachedSearch__(index => text.indexOf("-->", index)),
		nextBang: cachedSearch__(index => text.indexOf("--!>", index)),
		nextGt: cachedSearch__(index => text.indexOf(">", index))
	};

	while (!state.done)
	{
		const open = text.indexOf("<", state.index);
		const kind = open === -1 ? TEXT__ : kind__(state, open);

		if (open === -1) state.done = true;
		else if (kind === TEXT__) state.index = open + 1;
		else
		{
			flush__(state, open);
			HANDLERS__[kind](state, open);
		}
	}

	flush__(state, text.length);

	if (state.block !== null) state.parts.push(vault__(state.spans, text.slice(state.block.start)));

	return state;
}

/**
 * @description Minifies HTML content.
 * @param {string} content - Original HTML content.
 * @return {string} Minified output of the given HTML content.
 */
function minifyHtml__(content)
{
	const { parts, spans } = scan__(content);
	let minified = trimHtmlSpace__(collapseSpace__(parts.join(""), true));
	let previous;

	do
	{
		previous = minified;
		minified = stripHtmlCommentsOnce__(minified);
	} while (minified !== previous);

	return restoreVault__(spans, trimHtmlSpace__(minified));
}

export { minifyHtml__ };
