import { MARK_BOUNDARY__, MARK_COMMENT__, MARK_PREFIX__, MARK_SUFFIX__, resolveComments__ } from "./HtmlComments.js";
import { isTextElement__, payload__, textEnd__ } from "./HtmlPayload.js";
import {
	ESCAPES__, asciiLower__, attributeValue__, cachedSearch__, caseless__, collapseSpace__, escapeMarks__, isAsciiAlpha__, readTag__, searchFrom__,
	skipSpace__, tagSource__, tagText__, trimHtmlSpace__
} from "./HtmlTags.js";
import { MARK__, restoreVault__, vault__ } from "./Vault.js";

const TEXT__ = 0;
const START__ = 1;
const END__ = 2;
const COMMENT__ = 3;
const BOGUS__ = 4;
const CDATA__ = 5;
const COLLAPSE__ = 0;
const PRESERVE__ = 1;
const VERBATIM__ = 2;
const GAP_PART__ = 1;
const TAG_PART__ = 2;
const NOTE_PART__ = 3;
const DOCTYPE_PART__ = 4;

const GATE__ = new RegExp(`<(?:${["select", "frameset", "noscript", "col"].map(caseless__).join("|")})`, "u");
const WHITE_SPACE__ = /white-?space/iu;
const TABLE_TAG__ = /<(?:table|caption|col|t(?:body|foot|r|d|h))/iu;
const STYLE_END__ = new RegExp(`</${caseless__("style")}[\\t\\n\\f\\r />]`, "gu");
const FOREIGN_OPEN__ = /<(?:svg|math)[\t\n\f\r />]/iu;
const STYLE_ATTRIBUTE__ = /style[\t\n\f\r ]*=/iu;
const STYLE_ELEMENT__ = /<style[\t\n\f\r />]/iu;
const HIDDEN_STATE__ = new RegExp(`<(?:!--|(?:${["script", "style", "xmp", "iframe", "noembed", "noframes", "noscript", "textarea", "title", "plaintext", "svg", "math"].map(caseless__).join("|")})[\\t\\n\\f\\r />])`, "u");
const IGNORED_ROOT_GATE__ = new RegExp(`<(?:${["select", "frameset", "col"].map(caseless__).join("|")})`, "u");
const HTML_STATE_NAMES__ = new Set(["script", "style", "xmp", "iframe", "noembed", "noframes", "noscript", "textarea", "title", "plaintext"]);
const BLOCK_NAMES__ = new Set(["pre", "code", "listing"]);
const VAULTED_ELEMENTS__ = new Set(["script", "style", "textarea"]);
const FOREIGN_ROOTS__ = new Set(["svg", "math"]);
const INTEGRATION_POINTS__ = new Set(["foreignobject", "desc", "title", "mi", "mo", "mn", "ms", "mtext", "annotation-xml"]);
const SCOPE_MARKERS__ = new Set(["applet", "marquee", "object", "select", "table", "template"]);
const VERBATIM_CONTENT__ = new Set(["script", "style", "text", "tspan", "textpath", "title", "desc"]);
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
 * @description Adds a part to the output and notes what kind it is, for the rule on whitespace between tags.
 * @param {Object} state - Scanner state.
 * @param {number} kind - GAP_PART__, TAG_PART__, NOTE_PART__ or DOCTYPE_PART__.
 * @param {string} output - Text for the vaulted stream.
 * @return {void}
 */
function emitKind__(state, kind, output)
{
	state.kinds.set(state.parts.length, kind);
	state.parts.push(output);
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
	if (state.block === null) emitKind__(state, TAG_PART__, tagText__(state, tag, html));
}

/**
 * @description Tells whether text the scan will not read could spell white-space in a style, with a character reference, an escape or markup that splits the text.
 * @param {string} rest - The unscanned text.
 * @param {boolean} [foreign] - Whether the scan stopped inside svg or math content, which the rest may still be part of.
 * @return {boolean} True when the text has a style attribute and a "&" or a backslash, or a style element and a backslash, an svg or math element, or foreign content already open.
 */
function mayHoldEscape__(rest, foreign = false)
{
	return (STYLE_ATTRIBUTE__.test(rest) && ESCAPES__.test(rest)) || (STYLE_ELEMENT__.test(rest) && (foreign || rest.includes("\\") || FOREIGN_OPEN__.test(rest)));
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
	const { text, block } = state;
	const rest = text.slice(block === null ? open : block.start);

	if (mayHoldEscape__(rest, state.foreign.length > 0)) state.keep = true;

	state.parts.push(block === null ? boundary__(state, rest.slice(1), true) : boundary__(state, rest));
	state.block = null;
	state.done = true;
	advance__(state, text.length);
}

/**
 * @description Notes the content of a raw text or RCDATA element, or the rest of a document after a plaintext element, which the scan does not read; in a document with a select, frameset or col the parser may ignore the start tag, and then the content is markup that can spell white-space in a style.
 * @param {Object} state - Scanner state.
 * @param {number} from - Index where the content starts.
 * @param {number} to - Index where the content ends.
 * @return {void}
 */
function noteUnread__(state, from, to)
{
	if (state.ignorable && mayHoldEscape__(state.text.slice(from, to))) state.keep = true;
}

/**
 * @description Adds the pending text run to the output; one of whitespace alone is noted as a gap.
 * @param {Object} state - Scanner state.
 * @param {number} end - Index where the run ends.
 * @return {void}
 */
function flush__(state, end)
{
	const { text, textStart } = state;

	if (state.block !== null || end <= textStart) return;

	if (state.scope !== COLLAPSE__) state.parts.push(vault__(state.spans, text.slice(textStart, end)));
	else if (skipSpace__(text, textStart) >= end) emitKind__(state, GAP_PART__, escapeMarks__(state, textStart, end));
	else state.parts.push(escapeMarks__(state, textStart, end));
}

/**
 * @description Opens a foreign element.
 * @param {Object} state - Scanner state.
 * @param {Object} tag - Its start tag.
 * @return {void}
 */
function push__(state, tag)
{
	const { name, space } = tag;
	let { scope } = state;

	if (scope === VERBATIM__ || VERBATIM_CONTENT__.has(name)) scope = VERBATIM__;
	else if (space !== null) scope = attributeValue__(state.text, space) === "default" ? COLLAPSE__ : PRESERVE__;

	state.foreign.push(name);
	state.scopes.push(state.scope);
	state.scope = scope;

	if (INTEGRATION_POINTS__.has(name)) state.integration++;
}

/**
 * @description Closes foreign elements down to a stack depth.
 * @param {Object} state - Scanner state.
 * @param {number} depth - Number of foreign elements left open.
 * @return {void}
 */
function popTo__(state, depth)
{
	while (state.foreign.length > depth)
	{
		if (INTEGRATION_POINTS__.has(state.foreign.pop())) state.integration--;

		state.scope = state.scopes.pop();
	}
}

/**
 * @description Vaults a construct as a tag-like marker, "<" + marker + ">", so whitespace between it and a tag
 * collapses as it does between two tags.
 * @param {Object} state - Scanner state.
 * @param {string} source - The construct as it is to be restored, starting with "<".
 * @param {boolean} closed - Whether it ends with ">".
 * @param {number} [kind] - MARK_BOUNDARY__, or MARK_COMMENT__ for a comment the comment pass may drop.
 * @return {string} The marker text.
 */
function tagLike__(state, source, closed, kind = MARK_BOUNDARY__)
{
	const tail = closed ? ">" : "";
	const marker = `<${vault__(state.spans, source.slice(1, source.length - tail.length))}${tail}`;

	state.marks.set(state.spans.length - 1, kind | MARK_PREFIX__ | (closed ? MARK_SUFFIX__ : 0));
	if (kind === MARK_COMMENT__) state.comments = true;

	return marker;
}

/**
 * @description Vaults a construct that is not character data, and notes it as one the comment pass must not read across.
 * @param {Object} state - Scanner state.
 * @param {string} source - The construct as it is to be restored.
 * @param {boolean} [prefixed] - Whether the marker follows a "<" the source does not repeat (the source then starts after it).
 * @return {string} The marker text.
 */
function boundary__(state, source, prefixed = false)
{
	const marker = vault__(state.spans, source);

	state.marks.set(state.spans.length - 1, prefixed ? MARK_BOUNDARY__ | MARK_PREFIX__ : MARK_BOUNDARY__);

	return prefixed ? `<${marker}` : marker;
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
	if (VAULTED_ELEMENTS__.has(tag.name))
	{
		const element = tagSource__(state, tag) + payload__(state.text, tag, content, state.gated) + (endTag === null ? "" : tagSource__(state, endTag));

		emitKind__(state, TAG_PART__, tagLike__(state, element, endTag !== null));

		return;
	}

	emitKind__(state, TAG_PART__, tagText__(state, tag, true));

	if (content !== "") state.parts.push(vault__(state.spans, content));
	if (endTag !== null) emitKind__(state, TAG_PART__, tagText__(state, endTag, true));
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

	noteUnread__(state, tag.end, close === -1 ? text.length : close);

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

	noteUnread__(state, tag.end, text.length);
	emitTag__(state, tag, true);

	if (tag.end < text.length) emit__(state, vault__(state.spans, text.slice(tag.end)));

	state.done = true;
	advance__(state, text.length);
}

/**
 * @description Handles a start tag in HTML content; one that can make the parser ignore the end tag of the open preserved block (an HTML element that stops the scope search for it) leaves the rest of the document as written; those of SVG and MathML are latched in foreign content.
 * @param {Object} state - Scanner state.
 * @param {Object} tag - Complete start tag.
 * @return {void}
 */
function htmlStart__(state, tag)
{
	const { name } = tag;
	const { block } = state;

	if (block !== null && SCOPE_MARKERS__.has(name)) latch__(state, tag.start);
	else if (BLOCK_NAMES__.has(name))
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
		emitTag__(state, tag, !FOREIGN_ROOTS__.has(name));

		if (FOREIGN_ROOTS__.has(name) && !tag.selfClosing) push__(state, tag);

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
	if (state.integration > 0 || (state.ignorable && HTML_STATE_NAMES__.has(tag.name))) latch__(state, tag.start);
	else if (BREAKOUT__.has(tag.name) || (tag.name === "font" && tag.fontBreak))
	{
		popTo__(state, 0);
		htmlStart__(state, tag);
	}
	else
	{
		emitTag__(state, tag, false);

		if (!tag.selfClosing) push__(state, tag);

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
			state.parts.push(boundary__(state, state.text.slice(block.start, tag.end)));
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

	if (tag.styled || (tag.name === "style" && styleHoldsEscape__(state, tag))) state.keep = true;

	if (tag.end === -1) latch__(state, open);
	else if (state.foreign.length > 0) foreignStart__(state, tag);
	else htmlStart__(state, tag);
}

/**
 * @description Tells whether a style element's content can spell a property name other than as plain text: an escape, or in foreign content a reference or markup that splits the text.
 * @param {Object} state - Scanner state.
 * @param {Object} tag - The style start tag.
 * @return {boolean} True for a backslash before the next "</style" (HTML, where the text is raw); in foreign content, true unless the text up to the next "<" is free of "&" and backslash and that "<" starts the end tag.
 */
function styleHoldsEscape__(state, tag)
{
	if (state.foreign.length > 0)
	{
		const markup = state.nextMarkup(tag.end);

		return markup === -1 || state.nextStyleEnd(markup) !== markup || ESCAPES__.test(state.text.slice(tag.end, markup));
	}

	const slash = state.nextBackslash(tag.end);
	const end = state.nextStyleEnd(tag.end);

	return slash !== -1 && (end === -1 || slash < end);
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
 * @description Tells whether the character before a comment would join what follows the comment into one unit once the comment is gone.
 * @param {number} code - The code unit before the comment (NaN at the start of the text).
 * @return {boolean} True for CR (a LF after it makes one line break) and a high surrogate (a low one after it makes one character).
 */
function joinsNeighbour__(code)
{
	return code === 0x0D || (code >= 0xD800 && code <= 0xDBFF);
}

/**
 * @description Vaults a terminated comment as a tag-like marker for the comment pass; one right after a CR or a high surrogate is a
 * boundary the pass keeps as written, since removing it could join that character and the one after it. An unterminated comment
 * runs to the end of the text and stays in it, its U+0001 vaulted.
 * @param {Object} state - Scanner state.
 * @param {number} open - Index of its "<!--".
 * @return {void}
 */
function comment__(state, open)
{
	const { text } = state;
	const end = commentEnd__(state, open);
	const source = text.slice(open, end);

	if (state.block === null)
	{
		if (source.endsWith("-->") || source.endsWith("--!>"))
		{
			emitKind__(state, NOTE_PART__, tagLike__(state, source, true, joinsNeighbour__(text.charCodeAt(open - 1)) ? MARK_BOUNDARY__ : MARK_COMMENT__));
		}
		else
		{
			emitKind__(state, NOTE_PART__, escapeMarks__(state, open, end));
		}
	}

	advance__(state, end);
}

/**
 * @description Passes a bogus comment through, or vaults a DOCTYPE whole, up to its first ">".
 * @param {Object} state - Scanner state.
 * @param {number} open - Index of its "<".
 * @return {void}
 */
function bogus__(state, open)
{
	const { text } = state;
	const close = state.nextGt(open + 2);
	const end = close === -1 ? text.length : close + 1;
	const doctype = text[open + 1] === "!" && asciiLower__(text.slice(open + 2, open + 9)) === "doctype";

	if (state.block === null && doctype) emitKind__(state, DOCTYPE_PART__, tagLike__(state, text.slice(open, end), close !== -1));
	else if (state.block === null) emitKind__(state, NOTE_PART__, escapeMarks__(state, open, end));

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

	if (state.integration > 0 || state.ignorable)
	{
		latch__(state, open);

		return;
	}

	emit__(state, boundary__(state, text.slice(open, end)));
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
 * @return {Object} The scanner state: parts of the vaulted text, the vault's spans, the marks of the vaults the comment pass reads, and
 * whether the text has a comment for that pass to decide.
 */
function scan__(text)
{
	const state = {
		text,
		spans: [],
		parts: [],
		kinds: new Map(),
		marks: new Map(),
		comments: false,
		foreign: [],
		scopes: [],
		scope: COLLAPSE__,
		integration: 0,
		block: null,
		done: false,
		keep: false,
		gated: GATE__.test(text),
		ignorable: IGNORED_ROOT_GATE__.test(text),
		index: 0,
		textStart: 0,
		nextMark: cachedSearch__(index => text.indexOf(MARK__, index)),
		nextClose: cachedSearch__(index => text.indexOf("-->", index)),
		nextBang: cachedSearch__(index => text.indexOf("--!>", index)),
		nextGt: cachedSearch__(index => text.indexOf(">", index)),
		nextBackslash: cachedSearch__(index => text.indexOf("\\", index)),
		nextMarkup: cachedSearch__(index => text.indexOf("<", index)),
		nextStyleEnd: cachedSearch__(index => searchFrom__(STYLE_END__, text, index))
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

	if (state.block !== null) state.parts.push(boundary__(state, text.slice(state.block.start)));

	return state;
}

/**
 * @description Empties the gaps, runs of whitespace alone, that lie between two tags once the comments between them are gone; a gap next to text or a vaulted construct stays, as does one at the start or the end of the document, and a DOCTYPE counts as a tag only before any tag or text.
 * @param {Array<string>} parts - Output parts.
 * @param {Map<number, number>} kinds - Kind of each gap, tag, comment and DOCTYPE part, by its index in the parts.
 * @return {void}
 */
function dropBetweenTags__(parts, kinds)
{
	let gaps = [];
	let open = false;
	let prolog = true;
	let next = 0;

	for (const [index, kind] of kinds)
	{
		if (index !== next)
		{
			open = false;
			prolog = false;
		}

		next = index + 1;

		if (kind === GAP_PART__) gaps.push(index);
		else if (kind !== NOTE_PART__)
		{
			const boundary = kind === TAG_PART__ || prolog;

			if (boundary && open) for (const gap of gaps) parts[gap] = "";

			open = boundary;
			prolog = prolog && kind === DOCTYPE_PART__;
			gaps = [];
		}
	}
}

/**
 * @description Minifies HTML content; one that mentions white-space anywhere (a style attribute, a stylesheet, a class
 * name), or spells it with a character reference or an escape in a style attribute or element, keeps the whitespace in
 * its text as written, apart from a run of whitespace alone between two tags.
 * @param {string} content - Original HTML content.
 * @return {string} Minified output of the given HTML content.
 */
function minifyHtml__(content)
{
	const { parts, spans, kinds, marks, comments, keep: scanned } = scan__(content);
	const keep = scanned || WHITE_SPACE__.test(content);

	dropBetweenTags__(parts, kinds);

	let minified = collapseSpace__(parts.join(""), keep);

	if (!keep) minified = trimHtmlSpace__(minified);

	if (comments) minified = resolveComments__(minified, marks, spans, TABLE_TAG__.test(content));

	return restoreVault__(spans, keep ? minified : trimHtmlSpace__(minified));
}

export { minifyHtml__ };
