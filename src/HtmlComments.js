import { MARK__ } from "./Vault.js";

const MARK_BOUNDARY__ = 1;
const MARK_COMMENT__ = 2;
const MARK_PREFIX__ = 4;
const MARK_SUFFIX__ = 8;

const TEXT__ = 0;
const VOID__ = 1;
const BREAK__ = 2;
const NOTE__ = 3;

const EMPTY_KIND__ = 0;
const SPACE_KIND__ = 1;
const OTHER_KIND__ = 2;

const NUMERIC_REFERENCE__ = /&#(?:[xX]([\dA-Fa-f]+)|(\d+));?/uy;
const SPACE_VALUES__ = new Set([9, 10, 12, 13, 32]);

/**
 * @description Tells whether a code unit is an ASCII letter.
 * @param {number} code - Code unit.
 * @return {boolean} True for A-Z and a-z.
 */
function isLetter__(code)
{
	return (code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A);
}

/**
 * @description Tells whether a code unit is an ASCII letter or digit.
 * @param {number} code - Code unit.
 * @return {boolean} True for 0-9, A-Z and a-z.
 */
function isAlnum__(code)
{
	return isLetter__(code) || (code >= 0x30 && code <= 0x39);
}

/**
 * @description Tells whether a code unit is HTML whitespace.
 * @param {number} code - Code unit.
 * @return {boolean} True for tab, LF, FF, CR and space.
 */
function isSpace__(code)
{
	return code === 0x20 || code === 0x09 || code === 0x0A || code === 0x0C || code === 0x0D;
}

/**
 * @description Finds the end of a character reference to HTML whitespace.
 * @param {string} text - Text.
 * @param {number} index - Index of the "&".
 * @return {number} Index after the reference ("&#9;", "&#x20", "&Tab;", "&NewLine;"), or -1 when it is anything else.
 */
function spaceReferenceEnd__(text, index)
{
	if (text.startsWith("&Tab;", index)) return index + 5;
	if (text.startsWith("&NewLine;", index)) return index + 9;

	NUMERIC_REFERENCE__.lastIndex = index;

	const found = NUMERIC_REFERENCE__.exec(text);

	if (found === null) return -1;

	const hex = found[1] ?? "";
	const value = hex === "" ? Number.parseInt(found[2], 10) : Number.parseInt(hex, 16);

	return SPACE_VALUES__.has(value) ? NUMERIC_REFERENCE__.lastIndex : -1;
}

/**
 * @description Classifies character data by what an HTML parser does with it between two comments.
 * @param {string} text - Character data as it will be restored.
 * @return {number} EMPTY_KIND__ when it holds nothing or NUL alone (ignored in a table and in the body), SPACE_KIND__ when it is
 * HTML whitespace or references to it (a table keeps such a run in the table), OTHER_KIND__ otherwise (a table moves it out).
 */
function kindOf__(text)
{
	let kind = EMPTY_KIND__;
	let index = 0;

	while (index < text.length)
	{
		const code = text.charCodeAt(index);

		if (code === 0)
		{
			index++;
		}
		else if (isSpace__(code))
		{
			kind = SPACE_KIND__;
			index++;
		}
		else
		{
			const end = code === 0x26 ? spaceReferenceEnd__(text, index) : -1;

			if (end === -1) return OTHER_KIND__;

			kind = SPACE_KIND__;
			index = end;
		}
	}

	return kind;
}

/**
 * @description Moves the open-reference state over character data.
 * @param {number} state - 0 none, 1 right after "&", 2 after "&#", or after "&" or "&#" and name characters: a reference still open.
 * @param {string} text - Character data.
 * @return {number} The state after the text.
 */
function referenceAfter__(state, text)
{
	let result = state;

	for (let index = 0; index < text.length; index++)
	{
		const code = text.charCodeAt(index);

		if (code === 0x26) result = 1;
		else if ((code === 0x23 && result === 1) || (isAlnum__(code) && result !== 0)) result = 2;
		else result = 0;
	}

	return result;
}

/**
 * @description Adds a token that is not character data.
 * @param {Object} scan - Tokenizer state.
 * @param {number} type - VOID__, BREAK__ or NOTE__.
 * @param {number} start - Where it starts in the stream.
 * @param {number} end - Where it ends.
 * @return {void}
 */
function pushToken__(scan, type, start, end)
{
	scan.open = null;
	scan.tokens.push({
		type,
		start,
		end,
		text: "",
		kind: -1
	});
}

/**
 * @description Adds character data, to the open text token if there is one.
 * @param {Object} scan - Tokenizer state.
 * @param {string} text - The data as it will be restored.
 * @return {void}
 */
function addText__(scan, text)
{
	if (scan.open === null)
	{
		scan.open = {
			type: TEXT__,
			start: 0,
			end: 0,
			text: "",
			kind: -1
		};
		scan.tokens.push(scan.open);
	}

	scan.open.text += text;
}

/**
 * @description Reads the marker that starts at an index.
 * @param {Object} scan - Tokenizer state.
 * @param {number} from - Index of its first MARK.
 * @return {Object} Its closing MARK's index, its vault index, and what the scan registered for it (0 for a vault of text).
 */
function readMarker__(scan, from)
{
	const close = scan.stream.indexOf(MARK__, from + 1);
	const id = Number(scan.stream.slice(from + 1, close));

	return {
		close,
		id,
		flags: scan.marks.get(id) ?? 0
	};
}

/**
 * @description Adds a registered marker as a boundary or a comment.
 * @param {Object} scan - Tokenizer state.
 * @param {Object} marker - From readMarker__.
 * @param {number} start - Where the construct starts in the stream, its "<" included.
 * @return {number} Index after the construct, its ">" included.
 */
function pushMarker__(scan, marker, start)
{
	const end = marker.close + ((marker.flags & MARK_SUFFIX__) === 0 ? 1 : 2);

	pushToken__(scan, (marker.flags & MARK_COMMENT__) === 0 ? BREAK__ : NOTE__, start, end);

	return end;
}

/**
 * @description Reads what a "<" starts: a marker, "</>", a tag or a declaration or bogus comment up to its ">", or a "<" of text
 * (so is a "</" that ends the input: the tokenizer emits it as text).
 * @param {Object} scan - Tokenizer state.
 * @param {number} index - Index of the "<".
 * @return {number} Index after the construct.
 */
function readLess__(scan, index)
{
	const { stream } = scan;
	const next = stream.charCodeAt(index + 1);
	const marker = next === 1 ? readMarker__(scan, index + 1) : null;

	if (marker !== null && (marker.flags & MARK_PREFIX__) !== 0) return pushMarker__(scan, marker, index);

	if (stream.startsWith("</>", index))
	{
		pushToken__(scan, VOID__, index, index + 3);

		return index + 3;
	}

	if (next === 0x2F && index + 2 === stream.length)
	{
		addText__(scan, "</");

		return index + 2;
	}

	if (isLetter__(next) || next === 0x21 || next === 0x3F || next === 0x2F)
	{
		const gt = stream.indexOf(">", index + 1);
		const end = gt === -1 ? stream.length : gt + 1;

		pushToken__(scan, BREAK__, index, end);

		return end;
	}

	addText__(scan, "<");

	return index + 1;
}

/**
 * @description Reads the stream into tokens: character data (raw text and the vaults that hold text, with their restored text),
 * "</>" (nothing at all), a comment the pass may drop, and every other construct, none of which is character data.
 * @param {string} stream - The vaulted text.
 * @param {Map<number, number>} marks - What the scan registered for a vault index: MARK_BOUNDARY__ or MARK_COMMENT__, with MARK_PREFIX__ when
 * "<" stands before the marker and MARK_SUFFIX__ when ">" stands after it.
 * @param {Array<string>} spans - The vault's spans.
 * @return {Array<Object>} Tokens with a type, a start and end in the stream (not for text), and for character data its text and kind.
 */
function tokenize__(stream, marks, spans)
{
	const scan = {
		stream,
		marks,
		tokens: [],
		open: null
	};
	let index = 0;

	while (index < stream.length)
	{
		const code = stream.charCodeAt(index);

		if (code === 0x3C)
		{
			index = readLess__(scan, index);
		}
		else if (code === 1)
		{
			const marker = readMarker__(scan, index);

			if (marker.flags === 0) addText__(scan, spans[marker.id]);
			else pushMarker__(scan, marker, index);

			index = marker.close + 1;
		}
		else
		{
			let end = index + 1;

			while (end < stream.length && stream.charCodeAt(end) !== 0x3C && stream.charCodeAt(end) !== 1) end++;

			addText__(scan, stream.slice(index, end));
			index = end;
		}
	}

	return scan.tokens;
}

/**
 * @description Gives the kind of a text token, worked out once.
 * @param {Object} token - A text token.
 * @return {number} EMPTY_KIND__, SPACE_KIND__ or OTHER_KIND__.
 */
function kindAt__(token)
{
	if (token.kind === -1) token.kind = kindOf__(token.text);

	return token.kind;
}

/**
 * @description Gives the first character that follows a comment once it is gone.
 * @param {Object} token - The token after the comment.
 * @return {number} Its code, "<" for anything that is not text.
 */
function firstCode__(token)
{
	return token.type === TEXT__ ? token.text.charCodeAt(0) : 0x3C;
}

/**
 * @description Merges the kinds of the character data that follows a comment, up to the next comment or construct.
 * "</>" lies between pieces without ending the run of data; each piece is classified on its own, as a reference never reads across it.
 * @param {Array<Object>} tokens - All tokens.
 * @param {number} from - Index of the token after the comment.
 * @return {number} The merged kind, EMPTY_KIND__ when there is none.
 */
function followingKind__(tokens, from)
{
	let kind = EMPTY_KIND__;

	for (let at = from; at < tokens.length && (tokens[at].type === TEXT__ || tokens[at].type === VOID__); at++)
	{
		if (tokens[at].type === TEXT__) kind = Math.max(kind, kindAt__(tokens[at]));
	}

	return kind;
}

/**
 * @description Tells whether dropping a comment would change what a parser makes of its neighbours. A comment followed by another
 * comment never stays (its next character is "<" and no data follows it before the next comment): the last of a run decides for the run.
 * @param {Object} state - What the pass carries: whether the output ends in "<", the open-reference state, the kind of the data since the
 * last construct (EMPTY_KIND__ when the document has no table tag).
 * @param {number} next - First character after the comment.
 * @param {number} behind - Kind of the data after the comment, up to the next comment or construct.
 * @return {boolean} True when the comment stays: it would make a tag, a declaration or a comment of "<" and what follows, join the halves of a
 * character reference, or merge character data that a table keeps and character data it moves out.
 */
function keeps__(state, next, behind)
{
	if (state.lastIsLess && (isLetter__(next) || next === 0x21 || next === 0x2F || next === 0x3F)) return true;
	if (state.reference !== 0 && (isAlnum__(next) || next === 0x23 || next === 0x3B)) return true;

	return state.before + behind === SPACE_KIND__ + OTHER_KIND__;
}

/**
 * @description Decides each comment the scan left in the stream: dropped, or replaced by an empty comment when dropping it
 * would change what a parser makes of the text around it. A run of adjacent comments becomes at most one.
 * @param {string} stream - The vaulted text with its comments as markers.
 * @param {Map<number, number>} marks - What the scan registered for a vault index (see tokenize__).
 * @param {Array<string>} spans - The vault's spans.
 * @param {boolean} tables - Whether the document has a table tag, the only place where a parser treats character data on the two sides of
 * a comment apart by what it holds; without one, only the rules on "<" and character references apply.
 * @return {string} The stream without the dropped comments.
 */
function resolveComments__(stream, marks, spans, tables)
{
	const tokens = tokenize__(stream, marks, spans);
	const state = {
		lastIsLess: false,
		reference: 0,
		before: EMPTY_KIND__
	};
	const output = [];
	let copied = 0;

	for (let index = 0; index < tokens.length; index++)
	{
		const token = tokens[index];

		if (token.type === TEXT__)
		{
			state.lastIsLess = token.text.endsWith("<");
			state.reference = referenceAfter__(state.reference, token.text);
			if (tables) state.before = Math.max(state.before, kindAt__(token));
		}
		else if (token.type === NOTE__)
		{
			const keep = index + 1 < tokens.length && keeps__(state, firstCode__(tokens[index + 1]), followingKind__(tokens, index + 1));

			output.push(stream.slice(copied, token.start));
			copied = token.end;

			if (keep)
			{
				output.push("<!---->");
				state.reference = 0;
				state.before = EMPTY_KIND__;
			}
		}
		else
		{
			state.lastIsLess = false;
			state.reference = 0;
			if (token.type === BREAK__) state.before = EMPTY_KIND__;
		}
	}

	output.push(stream.slice(copied));

	return output.join("");
}

export { MARK_BOUNDARY__, MARK_COMMENT__, MARK_PREFIX__, MARK_SUFFIX__, resolveComments__ };
