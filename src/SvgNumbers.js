import { skipSpace__, stickyAt__ } from "./SvgSyntax.js";

const FILTER_PRIMITIVES__ = [
	"feBlend", "feColorMatrix", "feComponentTransfer", "feComposite", "feConvolveMatrix", "feDiffuseLighting",
	"feDisplacementMap", "feDropShadow", "feFlood", "feGaussianBlur", "feImage", "feMerge", "feMorphology", "feOffset",
	"feSpecularLighting", "feTile", "feTurbulence"
];
const PRESENTATION_ELEMENTS__ = [
	"svg", "g", "defs", "use", "image", "switch", "a", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
	"text", "tspan", "foreignObject", "clipPath", "linearGradient", "radialGradient", "pattern", "symbol", "marker",
	"mask", "filter", "stop", ...FILTER_PRIMITIVES__
];
const BOX_ELEMENTS__ = ["svg", "symbol", "use", "image", "rect", "foreignObject", "pattern", "mask", "filter", ...FILTER_PRIMITIVES__];
const TRANSFORM_ELEMENTS__ = [
	"svg", "g", "defs", "use", "image", "switch", "a", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
	"text", "foreignObject", "clipPath"
];
const ANIMATION_ELEMENTS__ = ["animate", "animateMotion", "animateTransform"];

const PRESENTATION_ATTRIBUTES__ = [
	"opacity", "fill-opacity", "stroke-opacity", "stop-opacity", "stroke-width", "stroke-dasharray", "stroke-dashoffset",
	"stroke-miterlimit", "font-size"
];

const NUMERIC_ATTRIBUTES__ = new Map([
	...PRESENTATION_ATTRIBUTES__.map(name => [name, PRESENTATION_ELEMENTS__]),
	["transform", TRANSFORM_ELEMENTS__],
	["gradientTransform", ["linearGradient", "radialGradient"]],
	["patternTransform", ["pattern"]],
	["viewBox", ["svg", "symbol", "marker", "pattern", "view"]],
	["x", [...BOX_ELEMENTS__, "text", "tspan"]],
	["y", [...BOX_ELEMENTS__, "text", "tspan"]],
	["width", BOX_ELEMENTS__],
	["height", BOX_ELEMENTS__],
	["d", ["path"]],
	["points", ["polyline", "polygon"]],
	...["x1", "y1", "x2", "y2"].map(name => [name, ["line", "linearGradient"]]),
	...["cx", "cy", "r"].map(name => [name, ["circle", "radialGradient"]]),
	...["rx", "ry"].map(name => [name, ["rect", "ellipse"]]),
	...["fx", "fy", "fr"].map(name => [name, ["radialGradient"]]),
	["offset", ["stop"]],
	["dx", ["text", "tspan", "feOffset", "feDropShadow"]],
	["dy", ["text", "tspan", "feOffset", "feDropShadow"]],
	["rotate", ["text", "tspan"]],
	["stdDeviation", ["feGaussianBlur", "feDropShadow"]],
	...["k1", "k2", "k3", "k4"].map(name => [name, ["feComposite"]]),
	["scale", ["feDisplacementMap"]],
	["keyTimes", ANIMATION_ELEMENTS__],
	["keySplines", ANIMATION_ELEMENTS__]
].map(([name, elements]) => [name, new Set(elements)]));

const TRANSFORM_ATTRIBUTES__ = new Set(["transform", "gradientTransform", "patternTransform"]);

const PATH_ARGUMENTS__ = new Map([
	["M", 2], ["m", 2], ["L", 2], ["l", 2], ["T", 2], ["t", 2], ["H", 1], ["h", 1], ["V", 1], ["v", 1], ["C", 6], ["c", 6],
	["S", 4], ["s", 4], ["Q", 4], ["q", 4], ["A", 7], ["a", 7], ["Z", 0], ["z", 0]
]);

const SPACE_RUN__ = /[\t\n\r ]+/gu;
const NUMBER__ = /([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))([Ee][+-]?\d+)?/uy;
const UNIT__ = /(?:px|em|ex|rem|%|in|cm|mm|pt|pc|vw|vh|vmin|vmax)/uy;
const TRANSFORM_NAME__ = /(?:matrix|translate|scale|rotate|skewX|skewY)/uy;
const NUMBER_START__ = "0123456789.+-";

/**
 * @description Reads the separator after a token: XML whitespace with at most one comma.
 * @param {string} text - Attribute value.
 * @param {number} index - Where the separator starts.
 * @param {Array<Array>} pieces - Pieces read so far; the separator is added when it is not empty.
 * @param {boolean} commaAllowed - Whether a comma may appear.
 * @return {Object} End of the separator, and whether it held a comma.
 */
function readSeparator__(text, index, pieces, commaAllowed)
{
	let end = skipSpace__(text, index);
	let comma = false;

	if (commaAllowed && text[end] === ",")
	{
		comma = true;
		end = skipSpace__(text, end + 1);
	}

	if (end > index) pieces.push(["s", text.slice(index, end)]);

	return {
		end,
		comma
	};
}

/**
 * @description Reads one number token.
 * @param {string} text - Attribute value.
 * @param {number} index - Where the number must start.
 * @param {Array<Array>} pieces - Pieces read so far; the number is added.
 * @return {number} End of the number, or -1 when none starts there.
 */
function readNumber__(text, index, pieces)
{
	const match = stickyAt__(NUMBER__, text, index);

	if (match === null) return -1;

	pieces.push(["n", match[0], match]);

	return index + match[0].length;
}

/**
 * @description Splits a list of numbers with optional units into pieces.
 * @param {string} text - Attribute value.
 * @return {?Array<Array>} The pieces, or null when the value is not such a list.
 */
function numberListPieces__(text)
{
	const pieces = [];
	let index = readSeparator__(text, 0, pieces, false).end;

	while (index < text.length)
	{
		index = readNumber__(text, index, pieces);

		if (index === -1) return null;

		const unit = stickyAt__(UNIT__, text, index);

		if (unit !== null)
		{
			pieces.push(["u", unit[0]]);
			index += unit[0].length;
		}

		const separator = readSeparator__(text, index, pieces, true);

		if (separator.end === index && index < text.length) return null;
		if (separator.comma && separator.end === text.length) return null;

		index = separator.end;
	}

	return pieces;
}

/**
 * @description Reads the arguments of one path command, repeated groups included.
 * @param {string} text - Path data.
 * @param {number} index - Index just after the command letter.
 * @param {string} command - The command letter.
 * @param {Array<Array>} pieces - Pieces read so far; the arguments and separators are added.
 * @return {number} Index after the last group, or -1 when the arguments do not fit the command.
 */
function readPathArguments__(text, index, command, pieces)
{
	const count = PATH_ARGUMENTS__.get(command);
	const arc = command === "A" || command === "a";
	let at = readSeparator__(text, index, pieces, false).end;

	for (;;)
	{
		for (let argument = 0; argument < count; argument++)
		{
			if (argument > 0) at = readSeparator__(text, at, pieces, true).end;

			if (arc && (argument === 3 || argument === 4))
			{
				if (text[at] !== "0" && text[at] !== "1") return -1;

				pieces.push(["f", text[at]]);
				at++;
			}
			else
			{
				at = readNumber__(text, at, pieces);

				if (at === -1) return -1;
			}
		}

		const separator = readSeparator__(text, at, pieces, true);

		if (!NUMBER_START__.includes(text[separator.end] || "x"))
		{
			return separator.comma ? -1 : separator.end;
		}

		at = separator.end;
	}
}

/**
 * @description Splits SVG path data into pieces, checking each command's argument count.
 * @param {string} text - Path data.
 * @return {?Array<Array>} The pieces, or null when the value is not path data.
 */
function pathPieces__(text)
{
	const pieces = [];
	let index = readSeparator__(text, 0, pieces, false).end;

	if (index < text.length && text[index] !== "M" && text[index] !== "m") return null;

	while (index < text.length)
	{
		const command = text[index];

		if (!PATH_ARGUMENTS__.has(command)) return null;

		pieces.push(["c", command]);

		if (PATH_ARGUMENTS__.get(command) === 0)
		{
			index = readSeparator__(text, index + 1, pieces, false).end;
		}
		else
		{
			index = readPathArguments__(text, index + 1, command, pieces);

			if (index === -1) return null;
		}
	}

	return pieces;
}

/**
 * @description Reads the number arguments of one transform function, up to its closing parenthesis.
 * @param {string} text - Transform list.
 * @param {number} index - Index just after the opening parenthesis.
 * @param {Array<Array>} pieces - Pieces read so far; the arguments, separators and ")" are added.
 * @return {number} Index after the ")", or -1 when the arguments are not a number list.
 */
function readTransformArguments__(text, index, pieces)
{
	let at = readSeparator__(text, index, pieces, false).end;

	for (;;)
	{
		at = readNumber__(text, at, pieces);

		if (at === -1) return -1;

		const separator = readSeparator__(text, at, pieces, true);

		if (text[separator.end] === ")" && !separator.comma)
		{
			pieces.push(["c", ")"]);

			return separator.end + 1;
		}

		at = separator.end;
	}
}

/**
 * @description Splits a transform list into pieces.
 * @param {string} text - Transform list.
 * @return {?Array<Array>} The pieces, or null when the value is not a transform list.
 */
function transformPieces__(text)
{
	const pieces = [];
	let index = readSeparator__(text, 0, pieces, false).end;

	while (index < text.length)
	{
		const name = stickyAt__(TRANSFORM_NAME__, text, index);

		if (name === null) return null;

		pieces.push(["c", name[0]]);
		index = readSeparator__(text, index + name[0].length, pieces, false).end;

		if (text[index] !== "(") return null;

		pieces.push(["c", "("]);
		index = readTransformArguments__(text, index + 1, pieces);

		if (index === -1) return null;

		const separator = readSeparator__(text, index, pieces, true);

		if (separator.comma && separator.end === text.length) return null;

		index = separator.end;
	}

	return pieces;
}

/**
 * @description Applies main's three number rewrites to one number token.
 * @param {Array} match - The token's NUMBER__ match.
 * @return {string} The token, shortened.
 */
function shortenNumber__(match)
{
	const [, sign, digits, dotFraction, bareFraction, exponent] = match;
	let integer = digits || "";
	let fraction = dotFraction ?? bareFraction;

	if (integer !== "" && fraction)
	{
		let end = fraction.length;

		while (end > 0 && fraction[end - 1] === "0") end--;

		fraction = fraction.slice(0, end);

		if (fraction === "") return sign + integer + (exponent || "");
	}

	if (integer === "0" && fraction) integer = "";

	return sign + integer + (typeof fraction === "string" ? "." + fraction : "") + (exponent || "");
}

/**
 * @description Splits a numeric attribute value into pieces with its attribute's grammar.
 * @param {string} attribute - Attribute name.
 * @param {string} text - Attribute value.
 * @return {?Array<Array>} The pieces, or null when the value does not match the grammar.
 */
function piecesFor__(attribute, text)
{
	if (attribute === "d") return pathPieces__(text);

	return TRANSFORM_ATTRIBUTES__.has(attribute) ? transformPieces__(text) : numberListPieces__(text);
}

/**
 * @description Drops the separators from a piece list.
 * @param {Array<Array>} pieces - Pieces of a value.
 * @return {Array<Array>} Its tokens.
 */
function tokensOf__(pieces)
{
	return pieces.filter(piece => piece[0] !== "s");
}

/**
 * @description Tells whether two piece lists have the same tokens: kinds, numeric values and other text.
 * @param {Array<Array>} before - Pieces of the original value.
 * @param {?Array<Array>} after - Pieces of the rewritten value.
 * @return {boolean} True when they hold the same tokens.
 */
function sameTokens__(before, after)
{
	if (after === null) return false;

	const left = tokensOf__(before);
	const right = tokensOf__(after);

	return left.length === right.length && left.every((piece, index) =>
	{
		const other = right[index];

		if (piece[0] !== other[0]) return false;

		return piece[0] === "n" ? Number(piece[1]) === Number(other[1]) : piece[1] === other[1];
	});
}

/**
 * @description Shortens the numbers of an SVG attribute value that SVG defines as numeric on its element.
 * @param {string} element - Local name of an element in the SVG namespace.
 * @param {string} attribute - Attribute name.
 * @param {string} value - Attribute value, as written.
 * @return {string} The shortened value, or the value as written.
 */
function shortenSvgNumbers__(element, attribute, value)
{
	const elements = NUMERIC_ATTRIBUTES__.get(attribute);

	if (!elements || !elements.has(element) || value.includes("&")) return value;

	const pieces = piecesFor__(attribute, value);

	if (pieces === null) return value;

	const shortened = pieces.map(([kind, text, match]) =>
	{
		if (kind === "n") return shortenNumber__(match);

		return kind === "s" ? text.replaceAll(SPACE_RUN__, " ") : text;
	}).join("");

	return sameTokens__(pieces, piecesFor__(attribute, shortened)) ? shortened : value;
}

export { shortenSvgNumbers__ };
