import { MARK__, restoreVault__, vault__ } from "./Vault.js";

const ATTRIBUTE__ = 1;
const SOLIDUS__ = 2;
const CLOSE__ = 3;

const VOID_NAMES__ = ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"];
const FONT_BREAKOUT__ = new Set(["color", "face", "size"]);
const ESCAPES__ = /[&\\]/u;

const WORD_CHAR__ = /[\wſK]/u;
const UPPER_ASCII__ = /[A-Z]/gu;
const TAG_NAME_END__ = /[\t\n\f\r />]/gu;
const ATTRIBUTE_NAME_END__ = /[\t\n\f\r />=]/gu;
const UNQUOTED_VALUE_END__ = /[\t\n\f\r >]/gu;
const QUOTE_NEEDED__ = /[\t\n\f\r "'<=>`{}]/gu;
const SPACE__ = /[\t\n\f\r ]/gu;
const NON_ASCII__ = /[\u0080-\u{10FFFF}]/u;

/**
 * @description Tells whether a character is HTML whitespace.
 * @param {string} char - One character, or undefined past the end.
 * @return {boolean} True for tab, line feed, form feed, carriage return and space.
 */
function isSpace__(char)
{
	return char === " " || char === "\n" || char === "\t" || char === "\r" || char === "\f";
}

/**
 * @description Tells whether a character is an ASCII letter.
 * @param {string} char - One character, or undefined past the end.
 * @return {boolean} True for A-Z and a-z.
 */
function isAsciiAlpha__(char)
{
	return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");
}

/**
 * @description Lowercases ASCII letters only, as the HTML tokenizer does.
 * @param {string} text - Text.
 * @return {string} The text with A-Z lowercased.
 */
function asciiLower__(text)
{
	return NON_ASCII__.test(text) ? text.replaceAll(UPPER_ASCII__, upper => upper.toLowerCase()) : text.toLowerCase();
}

/**
 * @description Builds a regex source that matches a lowercase ASCII word in any ASCII case.
 * @param {string} word - Lowercase word.
 * @return {string} The source, one bracket class per letter.
 */
function caseless__(word)
{
	return word.replaceAll(/[a-z]/gu, letter => `[${letter.toUpperCase()}${letter}]`);
}

/**
 * @description Skips HTML whitespace.
 * @param {string} text - HTML.
 * @param {number} index - Where to start.
 * @return {number} Index of the first other character, or the text's length.
 */
function skipSpace__(text, index)
{
	let at = index;

	while (at < text.length && isSpace__(text[at])) at++;

	return at;
}

/**
 * @description Trims HTML whitespace from both ends.
 * @param {string} text - Text.
 * @return {string} The text without leading or trailing HTML whitespace.
 */
function trimHtmlSpace__(text)
{
	let start = 0;
	let end = text.length;

	while (start < end && isSpace__(text[start])) start++;
	while (end > start && isSpace__(text[end - 1])) end--;

	return text.slice(start, end);
}

/**
 * @description Runs a global, quantifier-free regex from an index.
 * @param {RegExp} regex - Global regex.
 * @param {string} text - Text to search.
 * @param {number} index - Where the search starts.
 * @return {number} Index of the match, or -1.
 */
function searchFrom__(regex, text, index)
{
	regex.lastIndex = index;

	const match = regex.exec(text);

	return match === null ? -1 : match.index;
}

/**
 * @description Caches a forward search.
 * @param {Function} find - Forward search: index of the first hit at or after its argument, or -1.
 * @return {Function} The same search, cached.
 */
function cachedSearch__(find)
{
	let from = -1;
	let at = -1;

	return index =>
	{
		if (from === -1 || index < from || (at !== -1 && at < index))
		{
			from = index;
			at = find(index);
		}

		return at;
	};
}

/**
 * @description Finds where a quoted or unquoted attribute value ends.
 * @param {string} text - HTML.
 * @param {Object} part - Attribute part whose value starts at part.value.
 * @return {?Object} The part with its end set, or null when the tag runs to the end of the text.
 */
function valueEnd__(text, part)
{
	const quote = text[part.value];

	if (quote === "\"" || quote === "'")
	{
		const close = text.indexOf(quote, part.value + 1);

		part.quoted = true;
		part.end = close + 1;

		return close === -1 ? null : part;
	}

	part.end = searchFrom__(UNQUOTED_VALUE_END__, text, part.value);

	return part.end === -1 ? null : part;
}

/**
 * @description Reads one attribute of a tag.
 * @param {string} text - HTML.
 * @param {number} from - End of the previous part.
 * @param {number} at - First character of the attribute name.
 * @return {?Object} The attribute part, or null when the tag runs to the end of the text.
 */
function attributePart__(text, from, at)
{
	const found = searchFrom__(ATTRIBUTE_NAME_END__, text, at + 1);
	const nameEnd = found === -1 ? text.length : found;
	const equals = skipSpace__(text, nameEnd);
	const part = {
		kind: ATTRIBUTE__,
		from,
		at,
		nameEnd,
		equals: -1,
		value: -1,
		end: nameEnd,
		quoted: false
	};

	if (text[equals] !== "=") return part;

	part.equals = equals;
	part.value = skipSpace__(text, equals + 1);

	return valueEnd__(text, part);
}

/**
 * @description Reads the next part of a tag: an attribute, a stray "/", or the closing ">" or "/>".
 * @param {string} text - HTML.
 * @param {number} from - End of the tag name or of the previous part.
 * @return {?Object} The part, or null when the tag runs to the end of the text.
 */
function tagPart__(text, from)
{
	const at = skipSpace__(text, from);

	if (at >= text.length) return null;
	if (text[at] === ">")
	{
		return {
			kind: CLOSE__,
			from,
			at,
			end: at + 1,
			selfClosing: false
		};
	}

	if (text[at] === "/")
	{
		const selfClosing = text[at + 1] === ">";

		return {
			kind: selfClosing ? CLOSE__ : SOLIDUS__,
			from,
			at,
			end: at + (selfClosing ? 2 : 1),
			selfClosing
		};
	}

	return attributePart__(text, from, at);
}

/**
 * @description Records the attribute facts the minifier needs, among them a style attribute that holds a character reference or a CSS escape, which can spell a property name.
 * @param {string} text - HTML.
 * @param {Object} tag - Tag being read.
 * @param {Object} part - Attribute part.
 * @return {void}
 */
function noteAttribute__(text, tag, part)
{
	const name = asciiLower__(text.slice(part.at, part.nameEnd));

	if (name === "type")
	{
		tag.types++;

		if (tag.types === 1) tag.type = part;
	}

	if (name === "xml:space" && tag.space === null) tag.space = part;

	tag.language = tag.language || name === "language";
	tag.styled = tag.styled || (name === "style" && part.equals !== -1 && ESCAPES__.test(text.slice(part.value, part.end)));
	tag.fontBreak = tag.fontBreak || FONT_BREAKOUT__.has(name);
}

/**
 * @description Reads a start or end tag per the HTML tokenizer's tag and attribute states.
 * @param {string} text - HTML.
 * @param {number} start - Index of its "<".
 * @param {boolean} isEnd - Whether it is an end tag.
 * @return {Object} The tag; its end is -1 when it runs to the end of the text.
 */
function readTag__(text, start, isEnd)
{
	const nameStart = start + (isEnd ? 2 : 1);
	const found = searchFrom__(TAG_NAME_END__, text, nameStart + 1);
	const nameEnd = found === -1 ? text.length : found;
	const tag = {
		start,
		isEnd,
		nameEnd,
		name: asciiLower__(text.slice(nameStart, nameEnd)),
		end: -1,
		selfClosing: false,
		types: 0,
		type: null,
		language: false,
		fontBreak: false,
		styled: false,
		space: null
	};
	let part = tagPart__(text, nameEnd);

	while (part !== null && part.kind !== CLOSE__)
	{
		if (part.kind === ATTRIBUTE__) noteAttribute__(text, tag, part);

		part = tagPart__(text, part.end);
	}

	if (part !== null)
	{
		tag.end = part.end;
		tag.selfClosing = part.selfClosing;
	}

	return tag;
}

/**
 * @description Returns an attribute's value as written, without quotes.
 * @param {string} text - HTML.
 * @param {Object} part - Attribute part.
 * @return {string} The raw value; empty when the attribute has none.
 */
function attributeValue__(text, part)
{
	if (part.equals === -1) return "";

	return part.quoted ? text.slice(part.value + 1, part.end - 1) : text.slice(part.value, part.end);
}

/**
 * @description Tells whether a tag name is a void element's, by main's prefix rule.
 * @param {string} name - ASCII-lowercased tag name.
 * @return {boolean} True when it starts with a void name not followed by a word character.
 */
function isVoid__(name)
{
	return VOID_NAMES__.some(voidName => name.startsWith(voidName) && !WORD_CHAR__.test(name.charAt(voidName.length)));
}

/**
 * @description Tells whether what follows an attribute value lets it lose its quotes.
 * @param {string} text - HTML.
 * @param {Object} part - Attribute part with a quoted value.
 * @param {Object} next - The tag's next part.
 * @param {boolean} voidSlash - Whether the tag's self-closing "/" is dropped.
 * @return {boolean} True when the value will be followed by whitespace or ">", and no "/" comes next.
 */
function followedByEnd__(text, part, next, voidSlash)
{
	const after = text[part.end];

	if (after === ">") return true;
	if (after === "/") return next.kind === CLOSE__ && voidSlash;
	if (!isSpace__(after)) return false;

	return next.kind === ATTRIBUTE__ || (next.kind === CLOSE__ && (!next.selfClosing || voidSlash));
}

/**
 * @description Tells whether an href or src value can lose its quotes.
 * @param {string} text - HTML.
 * @param {Object} part - Attribute part.
 * @param {Object} next - The tag's next part.
 * @param {boolean} voidSlash - Whether the tag's self-closing "/" is dropped.
 * @return {boolean} True when the name ends in href or src, = and the quote are adjacent, and the value is safe bare.
 */
function unquotable__(text, part, next, voidSlash)
{
	const name = asciiLower__(text.slice(part.at, part.nameEnd));

	return (name.endsWith("href") || name.endsWith("src")) && part.equals === part.nameEnd && part.value === part.equals + 1 &&
		part.end > part.value + 2 && searchFrom__(QUOTE_NEEDED__, text, part.value + 1) === part.end - 1 && followedByEnd__(text, part, next, voidSlash);
}

/**
 * @description Copies a range of the input, vaulting every U+0001 in it as its own span.
 * @param {Object} state - Scanner state.
 * @param {number} from - Start of the range.
 * @param {number} to - End of the range.
 * @return {string} The range, safe to put in the vaulted text.
 */
function escapeMarks__(state, from, to)
{
	const { text } = state;
	let output = "";
	let index = from;
	let mark = state.nextMark(index);

	while (mark !== -1 && mark < to)
	{
		output += text.slice(index, mark) + vault__(state.spans, MARK__);
		index = mark + 1;
		mark = state.nextMark(index);
	}

	return output + text.slice(index, to);
}

/**
 * @description Writes one attribute or stray "/" of a tag in its minified form.
 * @param {Object} state - Scanner state.
 * @param {Object} part - Attribute or solidus part.
 * @param {Object} next - The tag's next part.
 * @param {Object} edits - Which start-tag edits apply: start (unquoting) and voidSlash.
 * @return {string} The part, its value vaulted.
 */
function partText__(state, part, next, edits)
{
	const { text, spans } = state;
	const lead = escapeMarks__(state, part.from, part.kind === SOLIDUS__ ? part.end : part.nameEnd);

	if (part.kind === SOLIDUS__ || part.equals === -1) return lead;
	if (part.end === part.value) return `${lead}=`;
	if (edits.start && part.quoted && unquotable__(text, part, next, edits.voidSlash)) return `${lead}=${vault__(spans, attributeValue__(text, part))}`;

	return `${lead}=${vault__(spans, text.slice(part.value, part.end))}`;
}

/**
 * @description Writes a complete tag in its minified form: values vaulted, "=" spacing and the space before ">" dropped, and for an HTML void element's start tag the "/" dropped.
 * @param {Object} state - Scanner state.
 * @param {Object} tag - Complete tag from readTag__.
 * @param {boolean} html - Whether the tag is in HTML content rather than foreign content.
 * @return {string} The tag, its values vaulted.
 */
function tagParts__(state, tag, html)
{
	const { text } = state;
	const edits = {
		start: !tag.isEnd,
		voidSlash: html && !tag.isEnd && tag.selfClosing && isVoid__(tag.name)
	};
	let output = escapeMarks__(state, tag.start, tag.nameEnd);
	let previous = null;
	let part = tagPart__(text, tag.nameEnd);

	while (part.kind !== CLOSE__)
	{
		const next = tagPart__(text, part.end);

		output += partText__(state, part, next, edits);

		previous = part;
		part = next;
	}

	if (part.selfClosing) return output + (edits.voidSlash ? ">" : escapeMarks__(state, part.from, part.end));

	return output + (previous !== null && previous.kind === SOLIDUS__ ? escapeMarks__(state, part.from, part.end) : ">");
}

/**
 * @description Applies the stream's whitespace rules to one run of HTML whitespace.
 * @param {string} text - Vaulted text.
 * @param {number} start - Start of the run.
 * @param {number} end - End of the run.
 * @param {boolean} keep - Whether the run stays as it is.
 * @return {string} One space for a longer run or a line feed or tab, else the run as it is.
 */
function spaceRun__(text, start, end, keep)
{
	if (keep) return text.slice(start, end);
	if (end - start > 1 || text[start] === "\n" || text[start] === "\t") return " ";

	return text[start];
}

/**
 * @description Turns line feeds and tabs into spaces and every longer run of HTML whitespace into one space, in one pass.
 * @param {string} text - Vaulted text.
 * @param {boolean} [keep] - Whether every run stays as it is.
 * @return {string} The text with its whitespace collapsed.
 */
function collapseSpace__(text, keep = false)
{
	let output = "";
	let copied = 0;
	let start = searchFrom__(SPACE__, text, 0);

	while (start !== -1)
	{
		const end = skipSpace__(text, start);
		const run = spaceRun__(text, start, end, keep);

		if (run !== text.slice(start, end))
		{
			output += text.slice(copied, start) + run;
			copied = end;
		}

		start = searchFrom__(SPACE__, text, end);
	}

	return output + text.slice(copied);
}

/**
 * @description Writes a tag in its minified form with the whitespace inside it collapsed, its values vaulted.
 * @param {Object} state - Scanner state.
 * @param {Object} tag - Complete tag from readTag__.
 * @param {boolean} html - Whether the tag is in HTML content rather than foreign content.
 * @return {string} The tag.
 */
function tagText__(state, tag, html)
{
	return collapseSpace__(tagParts__(state, tag, html));
}

/**
 * @description Writes a tag in its minified form with the stream's whitespace rules applied and its values restored, for
 * an element that is vaulted whole.
 * @param {Object} state - Scanner state.
 * @param {Object} tag - Complete tag from readTag__.
 * @return {string} The tag as the final output holds it.
 */
function tagSource__(state, tag)
{
	return restoreVault__(state.spans, tagText__(state, tag, true));
}

export {
	ESCAPES__,
	asciiLower__,
	attributeValue__,
	cachedSearch__,
	caseless__,
	collapseSpace__,
	escapeMarks__,
	isAsciiAlpha__,
	readTag__,
	searchFrom__,
	skipSpace__,
	tagSource__,
	tagText__,
	trimHtmlSpace__
};
