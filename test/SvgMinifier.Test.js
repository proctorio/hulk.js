import minify__ from "../src/index.js";
import { cpuMs__, difference__ } from "./TestSupport.js";

// How minifySvg__ (src/SvgMinifier.js; numbers in src/SvgNumbers.js, DOCTYPE and helpers in src/SvgSyntax.js) works.
// The notes live here, not in src: src keeps only the JSDoc the lint requires (WI 47101, plan section "SVG").
//
// Main ran seven global regexes over the whole file ("\s+" collapses, every newline deleted, "\s*=\s*" -> "=", three
// number rewrites). They did not know where a tag, a value or a text node starts, so they rewrote content SVG must keep:
// S1 xml:space="preserve" and the space between <tspan>s; inline <style>/<script> flattened onto one line (a // comment
// then eats the code after it); S2 a single newline deleted ("<path\nd=" became the element "pathd", points="0,0\n10,10"
// two numbers fewer); S3 numbers rewritten outside numbers (<?xml version="1.0"?> -> "1", which libxml2 rejects,
// id="icon-1.0", d="M1.0.5" -> "M1.5"); S4 "=" spacing inside text and values.
//
// The scanner reads the document once, in order, with XML's rules: case-sensitive names, whitespace [\t\n\r ] only (an
// NBSP is text, never a separator). Everything it must keep byte for byte goes into the vault (src/Vault.js: the span is
// replaced by U+0001 index U+0001, and every U+0001 of the input is a span of its own); what stays exposed is tag
// skeletons, whitespace it has already settled, and comments. The only global rule left is wi-47095's comment strip
// (stripSvgComments__), and the vault is restored after it in one pass.
// - "<?...?>", CDATA sections and the DOCTYPE (quoted literals and an internal subset with its declarations, comments
//   and PIs) are vaulted verbatim.
// - Comments: only an XML comment is exposed to the strip: "<!--", then a first "--" that is "-->". Anything else that
//   main's regex would strip ("<! --", "-- >", "<!-- a -- b -->", "<!-- a --->") is not well-formed XML, and removing
//   it could make a document XML rejects into one it accepts, so the rest of the document is kept as written (diff r3).
// - A start tag is read with XML's attribute grammar (name, "=", a quoted value). Whitespace between the name and the
//   attributes and between attributes becomes one space (S2: never nothing), "\s*=\s*" becomes "=", and the whitespace
//   before ">" or "/>" gets what main's rules gave a lone run (two or more characters -> " ", a lone newline -> nothing).
//   End tags the same. Every value is vaulted; only the numeric ones below are rewritten first.
// - Numeric values: the (element, attribute) pair is in the plan's table (SVG defines that attribute as a number, list,
//   path or transform on that element), the element is in the SVG namespace, the value has no "&", and the whole value
//   matches the attribute's grammar: d is path data (per-command argument counts, the arc flags as single "0"/"1"
//   characters), transform/gradientTransform/patternTransform a list of matrix/translate/scale/rotate/skewX/skewY with
//   number arguments, every other attribute numbers with an optional unit separated by whitespace or commas. Then each
//   number gets only main's three rewrites (1.0 -> 1, 1.50 -> 1.5, 0.5 -> .5, never "1." -> "1"), whitespace runs become
//   one space, and the result must split into the same tokens with the same numeric values (M1.0.5 would become the one
//   number M1.5); otherwise the value stays as written. Presentation attributes are taken on the table's elements other
//   than view and the animation elements, where SVG defines none.
// - Namespaces: the default namespace and prefix bindings are scoped per element (a binding stack per prefix). An
//   unprefixed element is SVG when the in-scope default namespace is SVG's or none was declared; xmlns="" is no
//   namespace; a prefixed one when its prefix is bound to SVG's. A namespace value with "&" never equals SVG's, so it
//   counts as unknown.
// - Character data: in an xml:space="preserve" scope (inherited; only exactly "default" resets it, so "&#112;reserve"
//   preserves), or anywhere inside text, tspan, textPath, title, desc, foreignObject, script or style (by local name, in
//   any namespace), it is vaulted. Elsewhere whitespace-only text between two markup constructs is dropped (main's
//   ">\s+<"), at a document edge it gets main's lone-run rule, and any other text is vaulted: outside SVG's text elements
//   it is either not rendered or application data (metadata), so it is kept rather than reformatted.
// - Payloads: a style (no type, or text/css) or script (no type, type "", or a type that trimmed is one of the four JS
//   MIME types; no language attribute; no "module" in SVG) element in the SVG namespace, outside a preserve scope and
//   outside the text elements, whose content is exactly whitespace + one CDATA section + whitespace (the body goes to the
//   CSS or JS minifier) or text with no "&" and no "<" (minified whole). A minified CDATA body holding "]]>", or
//   minified text holding "<", "&" or "]]>", is not used. Anything else stays verbatim.
// - Any DOCTYPE (an ASCII case-insensitive "<!doctype" anywhere in the input): an internal or external subset can
//   default xmlns or xml:space on any element, so the document gets only tag-internal whitespace and comment edits.
// - Where the scanner cannot be sure of the rest (an unterminated construct, a malformed tag, "<" in a value, a
//   duplicate attribute, an end tag that does not close the innermost element, "<" not starting XML markup), the rest of
//   the document from that point is vaulted verbatim.
//
// Linear: one pass with indexOf and sticky regexes; every construct's end is searched once from its start (a payload's
// look-ahead at most once more), and the scan resumes after it. Numbers are read by one sticky regex with no
// overlapping quantifiers.
//
// The payload minifiers are being rewritten in parallel, so payload expectations below are computed with
// minify__(payload, "css"/"js") rather than written out.

const SVG_NS__ = "http://www.w3.org/2000/svg";
const ROOT__ = `<svg xmlns="${SVG_NS__}">`;

// Generous per-test limit for the large inputs: v8 coverage slows them down several times over.
const SLOW_TEST_MS__ = 60000;

// Large inputs: at least this many characters, and one character above U+00FF so V8 keeps the string two-byte.
const LARGE__ = 600000;
const CPU_LIMIT_MS__ = 3000;

/**
 * @description Minifies SVG.
 * @param {string} input - SVG.
 * @return {string} Output.
 */
function svg(input)
{
	return minify__(input, "svg");
}

/**
 * @description Expected output for a style or script payload, minified by the CSS or JS minifier.
 * @param {string} payload - Payload text.
 * @param {string} language - "css" or "js".
 * @return {string} The minifier's output.
 */
function payload(payload, language)
{
	return minify__(payload, language);
}

describe("SVG plan cases (red on main)", () =>
{
	it("S1 keeps character data in an xml:space=preserve scope", () =>
	{
		const input = `${ROOT__}<g xml:space="preserve">  <path d="M0 0"/>\n  <path d="M1 1"/>  </g></svg>`;

		expect(svg(input)).toBe(input);
	});

	it("S1 keeps the space between tspans", () =>
	{
		const input = `${ROOT__}\n  <text x="10"><tspan>Hello</tspan> <tspan>world</tspan></text>\n</svg>`;

		expect(svg(input)).toBe(`${ROOT__}<text x="10"><tspan>Hello</tspan> <tspan>world</tspan></text></svg>`);
	});

	it("S1 minifies an inline style with the CSS minifier", () =>
	{
		const body = "\n  .a {\n    fill: red;\n  }\n  .b\n  .c { stroke: blue; }\n";

		expect(svg(`${ROOT__}<style>${body}</style></svg>`)).toBe(`${ROOT__}<style>${payload(body, "css")}</style></svg>`);
	});

	it("S1 minifies an inline script with the JS minifier, so a // comment no longer eats the next line", () =>
	{
		const body = "\n  // say hello\n  alert(1);\n";
		const output = svg(`${ROOT__}<script>${body}</script></svg>`);

		expect(output).toBe(`${ROOT__}<script>${payload(body, "js")}</script></svg>`);
		expect(output).toContain("alert(1);");
	});

	it("S1 minifies a script's CDATA body", () =>
	{
		const body = "\n  if (a < b && c) { go(); } // done\n  next();\n";

		expect(svg(`${ROOT__}<script>\n<![CDATA[${body}]]>\n</script></svg>`)).toBe(`${ROOT__}<script><![CDATA[${payload(body, "js")}]]></script></svg>`);
	});

	it("S2 turns a newline between numbers into a space", () =>
	{
		expect(svg(`${ROOT__}<polyline points="0,0\n10,10"/></svg>`)).toBe(`${ROOT__}<polyline points="0,0 10,10"/></svg>`);
	});

	it("S2 keeps a newline after the element name as a separator", () =>
	{
		expect(svg(`${ROOT__}<path\nd="M0 0"/></svg>`)).toBe(`${ROOT__}<path d="M0 0"/></svg>`);
	});

	it("S2 keeps a newline between attributes as a separator", () =>
	{
		expect(svg(`${ROOT__}<rect fill="a"\nstroke="b"\r\n\twidth="1"/></svg>`)).toBe(`${ROOT__}<rect fill="a" stroke="b" width="1"/></svg>`);
	});

	it("S3 keeps the XML declaration's version", () =>
	{
		const input = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${ROOT__}<path d="M0.50 1.0"/></svg>`;

		expect(svg(input)).toBe(`<?xml version="1.0" encoding="UTF-8" standalone="no"?>${ROOT__}<path d="M.5 1"/></svg>`);
	});

	it("S3 does not merge two path numbers", () =>
	{
		expect(svg(`${ROOT__}<path d="M1.0.5"/></svg>`)).toBe(`${ROOT__}<path d="M1.0.5"/></svg>`);
	});

	it("S3 keeps numbers in an id and in text", () =>
	{
		const input = `${ROOT__}<g id="icon-1.0"><text>v2.0 costs 0.50</text></g></svg>`;

		expect(svg(input)).toBe(input);
	});

	it("S4 keeps = spacing in text and in attribute values", () =>
	{
		const input = `${ROOT__}<text aria-label="a = b">a = b</text></svg>`;

		expect(svg(input)).toBe(input);
	});
});

describe("SVG reviewer probes", () =>
{
	it("r1: M1.5.0 and M1.01.0 keep both numbers (red on main)", () =>
	{
		expect(svg(`${ROOT__}<path d="M1.5.0"/><path d="M1.01.0"/></svg>`)).toBe(`${ROOT__}<path d="M1.5.0"/><path d="M1.01.0"/></svg>`);
	});

	it("r1: an animation's values attribute is never numeric (red on main)", () =>
	{
		const input = `${ROOT__}<animate attributeName="fill" values="url(#g1.0);url(#g2.0)"/></svg>`;

		expect(svg(input)).toBe(input);
	});

	it("r1: an NBSP is not a number separator (main already does this right)", () =>
	{
		const input = `${ROOT__}<polyline points="0,0\u00A010,10"/></svg>`;

		expect(svg(input)).toBe(input);
	});

	it("r1: M0.5 -> M.5 in complete path data (main already does this right)", () =>
	{
		expect(svg(`${ROOT__}<path d="M0.5,0.5"/></svg>`)).toBe(`${ROOT__}<path d="M.5,.5"/></svg>`);
	});

	it("r1: a moveto with one coordinate is not path data, so it stays as written (main rewrites it)", () =>
	{
		expect(svg(`${ROOT__}<path d="M0.5"/></svg>`)).toBe(`${ROOT__}<path d="M0.5"/></svg>`);
	});

	it("r1: xml:space on svg and a is inherited (red on main)", () =>
	{
		const outer = "<svg xml:space=\"preserve\"> <g>  <path/> </g> </svg>";
		const link = `${ROOT__}<a xml:space="preserve"> <path/>  x  y </a></svg>`;

		expect(svg(outer)).toBe(outer);
		expect(svg(link)).toBe(link);
	});

	it("r1: standalone tspan and textPath and a prefixed svg:text keep their text (red on main)", () =>
	{
		const standalone = `${ROOT__}<tspan>a  b</tspan><textPath>c\nd</textPath></svg>`;
		const prefixed = `<s:svg xmlns:s="${SVG_NS__}"><s:text>a  b</s:text></s:svg>`;

		expect(svg(standalone)).toBe(standalone);
		expect(svg(prefixed)).toBe(prefixed);
	});

	it("r1: </text> inside CDATA or a comment does not end the text (red on main)", () =>
	{
		expect(svg(`${ROOT__}<text><![CDATA[</text>]]>  a  </text></svg>`)).toBe(`${ROOT__}<text><![CDATA[</text>]]>  a  </text></svg>`);
		expect(svg(`${ROOT__}<text><!-- </text> -->a  b</text></svg>`)).toBe(`${ROOT__}<text>a  b</text></svg>`);
	});

	it("r1: </text> inside a quoted value is malformed XML, so the rest stays as written (red on main)", () =>
	{
		const input = `${ROOT__}\n<text title="</text>">a  b</text></svg>`;

		expect(svg(input)).toBe(`${ROOT__}<text title="</text>">a  b</text></svg>`);
	});

	it("r1: names are case-sensitive (red on main)", () =>
	{
		const input = "<svg viewbox=\"0 0 10.0 10\"><linearGradient gradientTransform=\"rotate(45.0)\"/><linearGradient gradienttransform=\"rotate(45.0)\"/></svg>";

		expect(svg(input)).toBe("<svg viewbox=\"0 0 10.0 10\"><linearGradient gradientTransform=\"rotate(45)\"/><linearGradient gradienttransform=\"rotate(45.0)\"/></svg>");

		// an element name in another case is no SVG element at all, so the document keeps its numbers (diff r5)
		const unknown = "<svg><lineargradient gradientTransform=\"rotate(45.0)\"/><rect width=\"1.0\"/></svg>";

		expect(svg(unknown)).toBe(unknown);
	});

	it("r1: a DTD entity value keeps its spaces (red on main)", () =>
	{
		const input = "<!DOCTYPE svg [<!ENTITY x \"a   b\">]><svg><text>&x;</text></svg>";

		expect(svg(input)).toBe(input);
	});

	it("r1: an SVG script with a character reference stays as written (main already does this right)", () =>
	{
		const input = "<svg><script>//comment&#10;alert(1)</script></svg>";

		expect(svg(input)).toBe(input);
	});

	it("r2: a numeric value with a character reference stays as written (main already does this right)", () =>
	{
		const input = `<svg xmlns="${SVG_NS__}" width="&#49;.0"/>`;

		expect(svg(input)).toBe(input);
	});

	it("r2: an element in another default namespace keeps its values (main already does this right)", () =>
	{
		const input = `${ROOT__}<metadata><item xmlns="urn:data" width="1."/></metadata></svg>`;

		expect(svg(input)).toBe(input);
	});

	it("r2: arc flags are single characters, so 01.0 is two flags and .0 (red on main)", () =>
	{
		const input = `${ROOT__}<path d="M0 0A10 10 0 01.0 0"/><path d="M1 1A10 10 0 01.0 0"/></svg>`;

		expect(svg(input)).toBe(input);
	});

	it("r2: arc arguments still get the number rewrites (main already does this right)", () =>
	{
		expect(svg(`${ROOT__}<path d="M0 0A10.0 10.50 0 1,0 0.5 1"/></svg>`)).toBe(`${ROOT__}<path d="M0 0A10 10.5 0 1,0 .5 1"/></svg>`);
	});

	it("r3: a non-JS script type stays as written (main already does this right)", () =>
	{
		const input = `${ROOT__}<script type="text/x-template"> //keep</script></svg>`;

		expect(svg(input)).toBe(input);
	});

	it("r3: a style in another namespace stays as written (main already does this right)", () =>
	{
		const input = `${ROOT__}<metadata><style xmlns="urn:data">a { x: 0px }</style></metadata></svg>`;

		expect(svg(input)).toBe(input);
	});

	it("r3: an ATTLIST that defaults xmlns puts the document in conservative mode (red on main)", () =>
	{
		const input = `<!DOCTYPE svg [<!ATTLIST item xmlns CDATA "urn:data">]>\n${ROOT__}<metadata><item width="1."/></metadata></svg>`;

		expect(svg(input)).toBe(input);
	});

	it("r3: an encoded xml:space value counts as preserve (red on main)", () =>
	{
		const input = `<svg xmlns="${SVG_NS__}" xml:space="pre&#115;erve"> <path/> </svg>`;

		expect(svg(input)).toBe(input);
	});

	it("r3: whitespace between elements outside a preserve scope still goes (main already does this right)", () =>
	{
		const input = `${ROOT__}<g> <path/> </g><metadata><item width="1."/></metadata></svg>`;

		expect(svg(input)).toBe(`${ROOT__}<g><path/></g><metadata><item width="1."/></metadata></svg>`);
	});

	it("r4: a parameter entity that declares an ATTLIST puts the document in conservative mode (red on main)", () =>
	{
		const input = `<!DOCTYPE svg [<!ENTITY % attrs "&#60;!ATTLIST item xmlns CDATA 'urn:data'>">%attrs;]>\n${ROOT__}<metadata><item width="1."/></metadata></svg>`;

		expect(svg(input)).toBe(input);
	});

	it("r4: an ATTLIST that defaults xml:space keeps the whitespace runs (red on main)", () =>
	{
		const input = `<!DOCTYPE svg [<!ATTLIST g xml:space (default|preserve) "preserve">]>\n${ROOT__}<g>  <path/>  </g></svg>`;

		expect(svg(input)).toBe(input);
	});

	it("r4: &#112;reserve counts as preserve (red on main)", () =>
	{
		const input = `${ROOT__}<g xml:space="&#112;reserve">  <path/>  </g></svg>`;

		expect(svg(input)).toBe(input);
	});

	it("r4: a metadata element inheriting SVG's namespace is not in the table (main already does this right)", () =>
	{
		const input = `${ROOT__}<metadata><item width="1."/></metadata></svg>`;

		expect(svg(input)).toBe(input);
	});

	it("r5: a CSS comment whose removal forms ]]> keeps the CDATA body as written (main already does this right)", () =>
	{
		const input = `${ROOT__}<style><![CDATA[a{b:[[]]/**/>}]]></style></svg>`;

		// premise: the CSS minifier forms the terminator (an ordinary declaration: custom-property values are kept as written)
		expect(payload("a{b:[[]]/**/>}", "css")).toContain("]]>");

		expect(svg(input)).toBe(input);
	});

	it("r5: an external DTD puts the document in conservative mode (red on main)", () =>
	{
		const input = `<!DOCTYPE svg SYSTEM "defaults.dtd">\n${ROOT__}<rect width="1."/><g>  <path/>  </g></svg>`;

		expect(svg(input)).toBe(input);
	});

	it("r5: a metadata g has no numeric width (main already does this right)", () =>
	{
		const input = `${ROOT__}<metadata><g width="1."/></metadata></svg>`;

		expect(svg(input)).toBe(input);
	});

	it("r5: an id is not numeric but viewBox is (red on main)", () =>
	{
		expect(svg("<svg id=\"icon-1.0\" viewBox=\"0 0 10.50 20.0\"/>")).toBe("<svg id=\"icon-1.0\" viewBox=\"0 0 10.5 20\"/>");
	});

	it("r6: a CSS comment whose removal forms ]]> in character data keeps the text as written (main already does this right)", () =>
	{
		const input = `${ROOT__}<style>a{--x:[[]]/**/>}</style></svg>`;

		expect(svg(input)).toBe(input);
	});

	it("r6: rect numbers get main's three rewrites (main already does this right)", () =>
	{
		expect(svg(`${ROOT__}<rect width="1.0" height="1.50" x="0.5"/></svg>`)).toBe(`${ROOT__}<rect width="1" height="1.5" x=".5"/></svg>`);
	});

	it("r6: a style inside foreignObject and a script with a character reference stay as written (main already does this right)", () =>
	{
		const foreign = "<svg><foreignObject><style>a { x: 0px }</style></foreignObject></svg>";
		const reference = "<svg><g><script>const x=1&#10; //keep</script></g></svg>";

		expect(svg(foreign)).toBe(foreign);
		expect(svg(reference)).toBe(reference);
	});

	it("r6: in an SVG file a style under an unknown element is still an SVG style (red on main)", () =>
	{
		expect(svg("<svg><g><p><style>a { x: 0px }</style></p></g></svg>")).toBe(`<svg><g><p><style>${payload("a { x: 0px }", "css")}</style></p></g></svg>`);
	});

	it("r9: an end tag that closes another element leaves the rest as written (main already does this right)", () =>
	{
		const input = "<svg><foreignObject><div></svg></div></foreignObject><script>//c&#10;alert(1)</script></svg>";

		expect(svg(input)).toBe(input);
	});

	it("r14: a CSS expression in a numeric attribute stays as written (red on main)", () =>
	{
		const opacity = `${ROOT__}<text style="--keep:'keep  keep'" opacity="if(style(--keep:'keep  keep'):1;else:0)">keep</text></svg>`;
		const fontSize = `${ROOT__}<text style="--keep:'keep  keep'" font-size="if(style(--keep:'keep  keep'):1px;else:2px)">keep</text></svg>`;
		const number = `${ROOT__}<text style="--keep:'keep1.0'" opacity="if(style(--keep:'keep1.0'):1;else:0)">keep</text></svg>`;

		expect(svg(opacity)).toBe(opacity);
		expect(svg(fontSize)).toBe(fontSize);
		expect(svg(number)).toBe(number);
	});

	it("r10-r13: HTML-context probes read as SVG: an end tag that closes another element leaves the rest as written (main already does this right)", () =>
	{
		const probes = [
			"<svg><p><textarea></svg><style>/*keep*/a{color:red}</style></textarea>",
			"<div><svg></div><textarea></svg><style>/*keep*/a{color:red}</style></textarea>",
			"<svg><title><select></title></svg><style>/*keep*/a{color:red}</style>"
		];

		for (const probe of probes) expect(svg(probe), probe).toBe(probe);
	});
});

describe("SVG output main already gets right is unchanged", () =>
{
	it("whitespace between elements and around the document", () =>
	{
		expect(svg("\n<svg>  <circle cx=\"50\" cy=\"50\" r=\"40\"/>  </svg>\n")).toBe("<svg><circle cx=\"50\" cy=\"50\" r=\"40\"/></svg>");
		expect(svg("  <svg>\n</svg>\n\n")).toBe(" <svg></svg> ");
		expect(svg("\t<svg/>\t")).toBe("\t<svg/>\t");
	});

	it("whitespace inside tags and around =", () =>
	{
		expect(svg("<svg width = \"100\" height = \"100\"><circle cx = \"50\" cy = \"50\" r = \"40\"/></svg>")).toBe("<svg width=\"100\" height=\"100\"><circle cx=\"50\" cy=\"50\" r=\"40\"/></svg>");
		expect(svg("<svg  ><path d=\"M0 0\" /><path d=\"M0 0\"\n/><path d=\"M0 0\"\t\t/></svg >")).toBe("<svg ><path d=\"M0 0\" /><path d=\"M0 0\"/><path d=\"M0 0\" /></svg >");
		expect(svg("<svg\n>\t<g\t/></svg\n>")).toBe("<svg><g\t/></svg>");
	});

	it("comments, including the forms main's regex strips", () =>
	{
		expect(svg("<!-- a -->\n<svg>\n  <!-- b -->\n  <g/>\n</svg><!---->")).toBe("<svg><g/></svg>");
		expect(svg("<svg><text><!--x-->ab</text></svg>")).toBe("<svg><text>ab</text></svg>");
	});

	it("number rewrites on numeric attributes", () =>
	{
		expect(svg("<svg><path d=\"M 10.0 20.0 L 30.0 40.0\"/></svg>")).toBe("<svg><path d=\"M 10 20 L 30 40\"/></svg>");
		expect(svg("<svg><circle cx=\"10.500\" cy=\"20.1000\" r=\"5.00\"/></svg>")).toBe("<svg><circle cx=\"10.5\" cy=\"20.1\" r=\"5\"/></svg>");
		expect(svg("<svg><rect opacity=\"0.5\" fill-opacity=\"0.75\" stroke-width=\"-0.50\"/></svg>")).toBe("<svg><rect opacity=\".5\" fill-opacity=\".75\" stroke-width=\"-.5\"/></svg>");
		expect(svg("<svg width=\"100\" height=\"200\"><circle r=\"10\"/></svg>")).toBe("<svg width=\"100\" height=\"200\"><circle r=\"10\"/></svg>");
		expect(svg("<svg><path d=\"M0,0c-0.385,1.398-0.936,2.775-1.127,4.2 c0.381-1.599,0.877-3.179,1.124-4.798z\"/></svg>")).toBe("<svg><path d=\"M0,0c-.385,1.398-.936,2.775-1.127,4.2 c.381-1.599,.877-3.179,1.124-4.798z\"/></svg>");
	});

	it("diff r3, r4, r5: no number edits when CSS or script in the document can read attribute text (red on main)", () =>
	{
		// a style element can match or print an attribute's text however it is spelled (escapes, character references,
		// any case), a script can read it, an external sheet is unknown, and attr() in a style attribute reads it too
		const root = "<svg xmlns=\"http://www.w3.org/2000/svg\">";
		const inputs = [
			`${root}<style>rect[width="1.0"]{fill:red}</style><rect width="1.0" height="1"/></svg>`,
			`${root}<style>rect&#91;width="1.0"&#93;{fill:red}</style><rect width="1.0" height="1"/></svg>`,
			`${root}<style>rect::after{content:ATTR(width)}</style><rect width="1.0"/></svg>`,
			`${root}<style>rect::after{content:a\\74tr(width)}</style><rect width="1.0"/></svg>`,
			`${root}<style>@IMPORT "a.css";</style><rect width="1.0"/></svg>`,
			`${root}<style><![CDATA[rect{fill:red}]]></style><rect width="1.0"/></svg>`,
			`${root}<STYLE/><rect width="1.0"/></svg>`,
			`<?xml-stylesheet href="a.css"?>${root}<rect width="1.0"/></svg>`,
			"<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:s=\"http://www.w3.org/2000/svg\"><s:style>rect{fill:red}</s:style><rect width=\"1.0\"/></svg>",
			`${root}<style type="text/css">rect{fill:red}</style><rect width="1.0"/></svg>`,
			`${root}<script>console.log(1)</script><rect width="1.0"/></svg>`,
			`${root}<link xmlns="http://www.w3.org/1999/xhtml" rel="stylesheet" href="a.css"/><rect width="1.0"/></svg>`,
			`${root}<rect width="1.0" style="--w:attr(width)"/></svg>`,

			// diff r5: numbers change only when every element is a known inert one and nothing else can read them
			"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1.0\" onload=\"console.log(this.getAttribute('width'))\"/>",
			"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1.0\" ONLOAD=\"f()\"/>",
			`${root}<rect width="1.0" style="--w:a\\74tr(width)"/></svg>`,
			`${root}<rect width="1.0" style="--w:a&#116;tr(width)"/></svg>`,
			`${root}<rect width="1.0" fill="ATTR(x)"/></svg>`,
			`${root}<rect width="1.0"><set attributeName="onclick" to="alert(this.getAttribute('width'))"/></rect></svg>`,
			`${root}<rect width="1.0"><set attributeName=" ONclick" to="f()"/></rect></svg>`,
			`${root}<a href="javascript:alert(document.querySelector('rect').getAttribute('width'))"><rect width="1.0"/></a></svg>`,
			`${root}<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"/></foreignObject><rect width="1.0"/></svg>`,
			`${root}<h:div xmlns:h="http://www.w3.org/1999/xhtml"/><rect width="1.0"/></svg>`,
			`${root}<unknown/><rect width="1.0"/></svg>`,
			`${root}<?php echo 1 ?><rect width="1.0"/></svg>`,
			`${root}<rect width="1.0"/><g a></svg>`,
			"<svg><script>f()</script><rect width=\"1.0\"/></svg>"
		];

		for (const input of inputs) expect(svg(input), input).toBe(input);

		// diff r5 controls: elements of other namespaces, a foreignObject of SVG, the declaration, and names or values that
		// only hold "on" later still allow number edits
		const metadata = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:i=\"http://ns.adobe.com/AdobeIllustrator/10.0/\" xmlns:x=\"\">";

		expect(svg(`${metadata}<i:pgf width="1.0"/><x:script/><foreignObject width="1.0"><rect width="1.0"/></foreignObject></svg>`)).toBe(`${metadata}<i:pgf width="1.0"/><x:script/><foreignObject width="1"><rect width="1"/></foreignObject></svg>`);
		expect(svg(`<?xml version="1.0"?>${root}<rect width="1.0" class="button" opacity="0.50"><set attributeName="opacity" to="0.5"/></rect></svg>`)).toBe(`<?xml version="1.0"?>${root}<rect width="1" class="button" opacity=".5"><set attributeName="opacity" to="0.5"/></rect></svg>`);

		// controls: nothing that reads attributes, though "[", "style" and "script" appear as text and names
		expect(svg(`${root}<rect width="1.0" class="style script"/><text>[1] style</text></svg>`)).toBe(`${root}<rect width="1" class="style script"/><text>[1] style</text></svg>`);
	});

	it("number shapes: exponents, signs, units, empty fractions, leading zeros", () =>
	{
		const input = "<svg><text x=\"1.0e5 +0.50 -0.0 0.0 1. 0. .50 00.5 10.0px 0.50% 1.0E-3\"/></svg>";

		expect(svg(input)).toBe("<svg><text x=\"1e5 +.5 -0 0 1. 0. .50 00.5 10px .5% 1E-3\"/></svg>");
	});
});

describe("SVG numeric attributes: table, namespace and grammar", () =>
{
	it("the attribute must be numeric on that element (red on main)", () =>
	{
		const input = `${ROOT__}<ellipse cx="1.0" rx="1.0"/><rect r="1.0" rx="1.0"/><g x="1.0" opacity="0.5"/><view viewBox="0 0 1.0 1" opacity="0.5"/><animate opacity="0.5" keyTimes="0.50"/></svg>`;

		expect(svg(input)).toBe(`${ROOT__}<ellipse cx="1.0" rx="1"/><rect r="1.0" rx="1"/><g x="1.0" opacity=".5"/><view viewBox="0 0 1 1" opacity="0.5"/><animate opacity="0.5" keyTimes=".5"/></svg>`);
	});

	it("every table entry rewrites its numbers (main already does this right)", () =>
	{
		const cases = [
			["line", "x1 y1 x2 y2"], ["linearGradient", "x1 y1 x2 y2"], ["radialGradient", "cx cy r fx fy fr"], ["stop", "offset"],
			["text", "x y dx dy rotate"], ["tspan", "x y dx dy rotate"], ["feOffset", "dx dy x y width height"],
			["feDropShadow", "dx dy stdDeviation"], ["feGaussianBlur", "stdDeviation"], ["feComposite", "k1 k2 k3 k4"],
			["feDisplacementMap", "scale"], ["use", "x y width height"], ["image", "x y width height"],
			["symbol", "viewBox x y width height"], ["marker", "viewBox"], ["pattern", "viewBox x y width height"],
			["mask", "x y width height"], ["filter", "x y width height"], ["foreignObject", "x y width height"],
			["polygon", "points"], ["animateMotion", "keyTimes keySplines"], ["animateTransform", "keyTimes keySplines"],
			["circle", "stroke-dasharray stroke-dashoffset stroke-miterlimit stroke-opacity fill-opacity font-size"],
			["stop", "stop-opacity"]
		];

		for (const [element, attributes] of cases)
		{
			const names = attributes.split(" ");
			const before = names.map(name => ` ${name}="0.50"`).join("");
			const after = names.map(name => ` ${name}=".5"`).join("");

			expect(svg(`${ROOT__}<${element}${before}/></svg>`), element).toBe(`${ROOT__}<${element}${after}/></svg>`);
		}
	});

	it("transform attributes take a transform list (main already does this right)", () =>
	{
		const input = `${ROOT__}<g transform="translate(10.0, 20.50) rotate( 0.5 ,1 , 2 )\n scale(2.0)skewX(1.0),skewY(0.0) matrix(1.0 0 0 1.0 0 0)"/><pattern patternTransform="scale(0.50)"/><radialGradient gradientTransform="translate (1.0)"/></svg>`;

		expect(svg(input)).toBe(`${ROOT__}<g transform="translate(10, 20.5) rotate( .5 ,1 , 2 ) scale(2)skewX(1),skewY(0) matrix(1 0 0 1 0 0)"/><pattern patternTransform="scale(.5)"/><radialGradient gradientTransform="translate (1)"/></svg>`);
	});

	it("values outside a grammar stay as written (red on main)", () =>
	{
		const values = [
			["g", "transform", "translate(10.0px)"], ["g", "transform", "translate()"], ["g", "transform", "translate(1.0,)"],
			["g", "transform", "translate(1.0) ,"], ["g", "transform", "translateX(1.0)"], ["g", "transform", "translate(1.0"],
			["g", "transform", "none"], ["rect", "width", "calc(1.0px + 2px)"], ["rect", "width", "var(--w, 1.0)"],
			["rect", "width", "auto"], ["rect", "width", "1.0ch"], ["rect", "width", "1.0PX"], ["rect", "width", "1.0px2.0px"],
			["rect", "width", "1.0,"], ["rect", "width", "1.0,,2"], ["rect", "width", "1.0 x"], ["rect", "width", "-"],
			["polygon", "points", "1.0.5"], ["polygon", "points", "1.0-2.0"], ["animate", "keyTimes", "0;0.50;1"],
			["circle", "stroke-dasharray", "none"], ["circle", "font-size", "medium"]
		];

		for (const [element, attribute, value] of values)
		{
			const input = `${ROOT__}<${element} ${attribute}="${value}"/></svg>`;

			expect(svg(input), value).toBe(input);
		}
	});

	it("path data needs complete argument groups and command letters (red on main)", () =>
	{
		const kept = [
			"L1.0 1", "M1.0", "M1.0 1 L", "M1.0 1 2.0", "M,1.0 1", "M1.0 1,L2 2", "M1.0 1 Z 2 3", "M1.0 1 A1 1 0 2 0 1 1",
			"M1.0 1 A1 1 0 0", "M1.0 1 X", "none", "M1.0 1,", "M1.0e 1", "M 1.0 1 H"
		];

		for (const d of kept)
		{
			const input = `${ROOT__}<path d="${d}"/></svg>`;

			expect(svg(input), d).toBe(input);
		}
	});

	it("path data with every command gets the rewrites (main already does this right)", () =>
	{
		const d = "M0.50,1.0 m1.0 1.0 2.0 2.0 L1.0,1 l1 1 H1.0 h1 V1.0 v1 C1.0 1 1 1 1 1 c1 1 1 1 1 1.0 S1.0 1 1 1 s1 1 1 1 Q1.0 1 1 1 q1 1 1 1 T1.0 1 t1 1 A1.0 1 0 1 1 1 1 a1 1 0.50 0,1 1 1 Z z\n\tM-0.5-0.5";

		expect(svg(`${ROOT__}<path d="${d}"/></svg>`)).toBe(`${ROOT__}<path d="M.5,1 m1 1 2 2 L1,1 l1 1 H1 h1 V1 v1 C1 1 1 1 1 1 c1 1 1 1 1 1 S1 1 1 1 s1 1 1 1 Q1 1 1 1 q1 1 1 1 T1 1 t1 1 A1 1 0 1 1 1 1 a1 1 .5 0,1 1 1 Z z M-.5-.5"/></svg>`);
	});

	it("the self-check keeps a value whose tokens would change, and accepts one whose tokens stay (red on main)", () =>
	{
		expect(svg(`${ROOT__}<path d="M0 0L1.0.5"/></svg>`)).toBe(`${ROOT__}<path d="M0 0L1.0.5"/></svg>`);
		expect(svg(`${ROOT__}<path d="M1.50.5 1..5"/></svg>`)).toBe(`${ROOT__}<path d="M1.5.5 1..5"/></svg>`);
	});

	it("whitespace inside a numeric value collapses to one space, an NBSP or other text keeps the whole value (red on main)", () =>
	{
		expect(svg(`${ROOT__}<svg viewBox=" 0\t0\r\n10.0  10 "/></svg>`)).toBe(`${ROOT__}<svg viewBox=" 0 0 10 10 "/></svg>`);
		expect(svg(`${ROOT__}<svg viewBox="0 0 10.0\u00A010"/></svg>`)).toBe(`${ROOT__}<svg viewBox="0 0 10.0\u00A010"/></svg>`);
		expect(svg(`${ROOT__}<svg viewBox="  "/></svg>`)).toBe(`${ROOT__}<svg viewBox=" "/></svg>`);
	});

	it("non-numeric values keep their whitespace and numbers (red on main)", () =>
	{
		const input = `${ROOT__}<g class="a\n  b" data-x="1.0  =  0.5" style="stroke-width: 1.0px"/></svg>`;

		expect(svg(input)).toBe(input);
	});

	it("only elements in the SVG namespace get numeric rewrites (red on main)", () =>
	{
		const cases = [
			[`<svg xmlns="${SVG_NS__}"><rect width="1.0"/></svg>`, `<svg xmlns="${SVG_NS__}"><rect width="1"/></svg>`],
			["<svg><rect width=\"1.0\"/></svg>", "<svg><rect width=\"1\"/></svg>"],
			["<svg xmlns=\"\"><rect width=\"1.0\"/></svg>", "<svg xmlns=\"\"><rect width=\"1.0\"/></svg>"],
			[`${ROOT__}<g xmlns="urn:x"><rect width="1.0"/></g><rect width="1.0"/></svg>`, `${ROOT__}<g xmlns="urn:x"><rect width="1.0"/></g><rect width="1"/></svg>`],
			["<svg xmlns=\"&ns_svg;\"><rect width=\"1.0\"/></svg>", "<svg xmlns=\"&ns_svg;\"><rect width=\"1.0\"/></svg>"],
			[`<s:svg xmlns:s="${SVG_NS__}"><s:rect width="1.0"/><rect width="1.0"/></s:svg>`, `<s:svg xmlns:s="${SVG_NS__}"><s:rect width="1"/><rect width="1"/></s:svg>`],
			["<svg:svg xmlns:svg=\"urn:x\"><svg:rect width=\"1.0\"/></svg:svg>", "<svg:svg xmlns:svg=\"urn:x\"><svg:rect width=\"1.0\"/></svg:svg>"],
			["<x:rect width=\"1.0\"/>", "<x:rect width=\"1.0\"/>"],
			[`<a:b:rect xmlns:a="${SVG_NS__}" width="1.0"/>`, `<a:b:rect xmlns:a="${SVG_NS__}" width="1.0"/>`],
			[`<svg xmlns:s="${SVG_NS__}"><g xmlns:s="urn:x"><s:rect width="1.0"/></g><s:rect width="1.0"/></svg>`, `<svg xmlns:s="${SVG_NS__}"><g xmlns:s="urn:x"><s:rect width="1.0"/></g><s:rect width="1"/></svg>`],
			[`<g xmlns:s="${SVG_NS__}"/><s:rect width="1.0"/>`, `<g xmlns:s="${SVG_NS__}"/><s:rect width="1.0"/>`],
			[`<svg xmlns:s="urn:x"><s:rect xmlns:s="${SVG_NS__}" width="1.0"/></svg>`, `<svg xmlns:s="urn:x"><s:rect xmlns:s="${SVG_NS__}" width="1"/></svg>`],
			["<svg xmlns:s=\"http://www.w3.org/2000/&#115;vg\"><s:rect width=\"1.0\"/></svg>", "<svg xmlns:s=\"http://www.w3.org/2000/&#115;vg\"><s:rect width=\"1.0\"/></svg>"],
			[`<svg><rect xmlns="${SVG_NS__} " width="1.0"/></svg>`, `<svg><rect xmlns="${SVG_NS__} " width="1.0"/></svg>`],
			[`${ROOT__}<rect svg:width="1.0" xmlns:svg="${SVG_NS__}"/></svg>`, `${ROOT__}<rect svg:width="1.0" xmlns:svg="${SVG_NS__}"/></svg>`]
		];

		for (const [input, expected] of cases) expect(svg(input), input).toBe(expected);
	});
});

describe("SVG character data", () =>
{
	it("xml:space is a stack: only exactly default resets it (red on main)", () =>
	{
		const input = `${ROOT__}<g xml:space="preserve"> <g xml:space="default"> <path/> </g> <g xml:space="Default"> <path/> </g> <g> <path/> </g> </g> <g> <path/> </g></svg>`;

		expect(svg(input)).toBe(`${ROOT__}<g xml:space="preserve"> <g xml:space="default"><path/></g> <g xml:space="Default"> <path/> </g> <g> <path/> </g> </g><g><path/></g></svg>`);
	});

	it("text elements keep their character data and their children's (red on main)", () =>
	{
		const input = `${ROOT__}<text> a  <tspan> b </tspan>\n<a> c </a> </text><title> T  t </title><desc>\n d \n</desc><foreignObject>\n <div xmlns="http://www.w3.org/1999/xhtml">  e  </div>\n</foreignObject></svg>`;

		expect(svg(input)).toBe(input);
	});

	it("whitespace-only text inside each text element stays, under any prefix (red on main)", () =>
	{
		// positive control: the same whitespace between g elements goes
		const input = `${ROOT__}<g><g/> <g/></g><tspan><tspan>a</tspan> <tspan>b</tspan></tspan><textPath><tspan>a</tspan> <tspan>b</tspan></textPath><title><a/> <a/></title><desc><a/> <a/></desc></svg>`;
		const prefixed = `<s:svg xmlns:s="${SVG_NS__}"><s:text><s:tspan>a</s:tspan> <s:tspan>b</s:tspan></s:text></s:svg>`;

		expect(svg(input)).toBe(`${ROOT__}<g><g/><g/></g><tspan><tspan>a</tspan> <tspan>b</tspan></tspan><textPath><tspan>a</tspan> <tspan>b</tspan></textPath><title><a/> <a/></title><desc><a/> <a/></desc></svg>`);
		expect(svg(prefixed)).toBe(prefixed);
	});

	it("text outside the text elements is kept as written; whitespace-only text between markup goes (red on main)", () =>
	{
		const input = `${ROOT__}\n<metadata>\n  <rdf:RDF xmlns:rdf="urn:rdf">\n    <dc:title xmlns:dc="urn:dc">My  icon\n v2.0 a = b</dc:title>\n  </rdf:RDF>\n</metadata>\n<g>\u00A0</g><g>\u00A0 \n</g></svg>`;

		expect(svg(input)).toBe(`${ROOT__}<metadata><rdf:RDF xmlns:rdf="urn:rdf"><dc:title xmlns:dc="urn:dc">My  icon\n v2.0 a = b</dc:title></rdf:RDF></metadata><g>\u00A0</g><g>\u00A0 \n</g></svg>`);
	});

	it("whitespace next to a comment, PI or CDATA section goes like main's >\\s+< (main already does this right)", () =>
	{
		expect(svg("<svg>\n<!--c-->\n<?pi x?>\n<![CDATA[ c ]]>\n<g/>\n</svg>")).toBe("<svg><?pi x?><![CDATA[ c ]]><g/></svg>");
		expect(svg("<svg><g>x <!--c--> y</g></svg>")).toBe("<svg><g>x  y</g></svg>");
	});

	it("diff r6: a comment right after text stays, since dropping it could join the text around it into ]]> or a reference (red on main)", () =>
	{
		// "]]>" in character data is an error and "&am" + "p;" would turn into a reference: the input XML accepts (or
		// rejects) would be rejected (or accepted). A comment after ">", XML whitespace or at the start still goes.
		const kept = [
			`${ROOT__}<text>]]<!-- text -->></text></svg>`,
			`${ROOT__}<text>&am<!-- text -->p;</text></svg>`,
			`${ROOT__}<text>&<!-- text -->#65;</text></svg>`,
			`${ROOT__}<text>]<!--a-->]<!--b-->></text></svg>`
		];

		for (const input of kept) expect(svg(input)).toBe(input);

		// a later comment after the whitespace that goes is dropped, the first one keeps the text apart
		expect(svg(`${ROOT__}<g>]]<!--a--> <!--b-->></g></svg>`)).toBe(`${ROOT__}<g>]]<!--a-->></g></svg>`);

		// control: comments at the start, after ">" and after whitespace go
		expect(svg(`<!--a-->${ROOT__}<text><!--b-->x <!--c-->y</text>\n<!--d--></svg>`)).toBe(`${ROOT__}<text>x y</text></svg>`);
	});

	it("diff r8: a comment right after CR stays, since dropping it would join that CR and a LF after it into one line break (red on main)", () =>
	{
		// XML reads CR LF as one line break: "a\r<!-- text -->\nb" holds two, "a\r\nb" one. A later comment in the chain
		// still goes, the first one keeps CR and LF apart.
		const preserve = `<svg xmlns="${SVG_NS__}" xml:space="preserve"><text>a\r<!-- text -->\nb</text></svg>`;

		expect(svg(preserve)).toBe(preserve);
		expect(svg(`${ROOT__}<text>a\r<!--a--><!--b-->\nb</text></svg>`)).toBe(`${ROOT__}<text>a\r<!--a-->\nb</text></svg>`);
		expect(svg(`${ROOT__}<text>a\r<!--a--> <!--b-->\nb</text></svg>`)).toBe(`${ROOT__}<text>a\r<!--a--> \nb</text></svg>`);

		// control: a comment after LF, or after CR LF, still goes
		expect(svg(`${ROOT__}<text>a\n<!--x-->\nb</text></svg>`)).toBe(`${ROOT__}<text>a\n\nb</text></svg>`);
		expect(svg(`${ROOT__}<text>a\r\n<!--x-->\r\nb</text></svg>`)).toBe(`${ROOT__}<text>a\r\n\r\nb</text></svg>`);
	});
});

describe("SVG style and script payloads", () =>
{
	it("diff r1: payloads end to end, written out (red on main)", () =>
	{
		// the other payload tests compute the expected payload with minify__(…, "css"/"js"); this one pins the bytes
		const input = "<svg xmlns=\"http://www.w3.org/2000/svg\"><style>\n  .a { fill: #ffffff; }\n  .b { width: 0px }\n</style><script><![CDATA[\n// c\nconst t = `x\n// keep\n`;\n]]></script></svg>";

		expect(svg(input)).toBe("<svg xmlns=\"http://www.w3.org/2000/svg\"><style> .a{fill:#fff}.b{width:0}</style><script><![CDATA[const t = `x\n// keep\n`;]]></script></svg>");
	});

	it("style types: none or text/css in any ASCII case (red on main)", () =>
	{
		const body = " a { fill : red ; } ";
		const minified = payload(body, "css");
		const cases = [
			["", minified], [" type=\"text/css\"", minified], [" type=\"TEXT/CSS\"", minified], [" type=\"text/css \"", body],
			[" type=\"\"", body], [" type=\"text/less\"", body], [" type=\"text&#47;css\"", body], [" media=\"screen\"", minified]
		];

		// premise: minifying changes this body
		expect(minified).not.toBe(body);

		for (const [attributes, expected] of cases)
		{
			expect(svg(`<svg><style${attributes}>${body}</style></svg>`), attributes).toBe(`<svg><style${attributes}>${expected}</style></svg>`);
		}
	});

	it("script types: none, empty, or a trimmed JS MIME type; no module, no language (red on main)", () =>
	{
		const body = "\n// c\nrun();\n";
		const minified = payload(body, "js");
		const cases = [
			["", minified], [" type=\"\"", minified], [" type=\"text/javascript\"", minified], [" type=\" Application/ECMAScript\t\"", minified],
			[" type=\"text/ecmascript\"", minified], [" type=\"application/javascript\"", minified], [" type=\" \"", body],
			[" type=\"module\"", body], [" type=\"text/x-template\"", body], [" type=\"application/json\"", body],
			[" language=\"javascript\"", body], [" type=\"text/javascript\" language=\"json\"", body], [" type=\"text&#47;javascript\"", body],
			[" href=\"a.js\"", minified]
		];

		// premise: minifying changes this body
		expect(minified).not.toBe(body);

		for (const [attributes, expected] of cases)
		{
			expect(svg(`<svg><script${attributes}>${body}</script></svg>`), attributes).toBe(`<svg><script${attributes}>${expected}</script></svg>`);
		}
	});

	it("payloads only for SVG-namespace elements outside preserve scopes and text elements, and with no DOCTYPE (red on main)", () =>
	{
		const body = " a { fill : red ; } ";
		const minified = payload(body, "css");
		const cases = [
			[`<s:svg xmlns:s="${SVG_NS__}"><s:style>${body}</s:style></s:svg>`, `<s:svg xmlns:s="${SVG_NS__}"><s:style>${minified}</s:style></s:svg>`],
			[`<svg xmlns="urn:x"><style>${body}</style></svg>`, `<svg xmlns="urn:x"><style>${body}</style></svg>`],
			[`<svg xml:space="preserve"><style>${body}</style></svg>`, `<svg xml:space="preserve"><style>${body}</style></svg>`],
			[`<svg><style xml:space="preserve">${body}</style></svg>`, `<svg><style xml:space="preserve">${body}</style></svg>`],
			[`<svg xml:space="preserve"><style xml:space="default">${body}</style></svg>`, `<svg xml:space="preserve"><style xml:space="default">${minified}</style></svg>`],
			[`<svg><g xml:space="preserve"><g xml:space="default"><text><g xml:space="default"><style>${body}</style></g></text></g></g></svg>`, `<svg><g xml:space="preserve"><g xml:space="default"><text><g xml:space="default"><style>${body}</style></g></text></g></g></svg>`],
			[`<svg><text><style>${body}</style></text></svg>`, `<svg><text><style>${body}</style></text></svg>`],
			[`<!DOCTYPE svg><svg><style>${body}</style></svg>`, `<!DOCTYPE svg><svg><style>${body}</style></svg>`],
			["<svg><style/><style></style><style> </style></svg>", "<svg><style/><style></style><style>" + payload(" ", "css") + "</style></svg>"]
		];

		for (const [input, expected] of cases) expect(svg(input), input).toBe(expected);
	});

	it("payload forms: plain text or one CDATA section; anything else stays as written (red on main)", () =>
	{
		const body = " a { fill : red ; } ";
		const minified = payload(body, "css");
		const cases = [
			[`<style>${body}</style >`, `<style>${minified}</style >`],
			[`<style>${body}</style\n>`, `<style>${minified}</style>`],
			[`<style>\n\t<![CDATA[${body}]]>\n\t</style>`, `<style><![CDATA[${minified}]]></style>`],
			[`<style><![CDATA[${body}]]><![CDATA[${body}]]></style>`, `<style><![CDATA[${body}]]><![CDATA[${body}]]></style>`],
			[`<style>x<![CDATA[${body}]]></style>`, `<style>x<![CDATA[${body}]]></style>`],
			[`<style><![CDATA[${body}]]>x</style>`, `<style><![CDATA[${body}]]>x</style>`],
			[`<style>${body}&amp;</style>`, `<style>${body}&amp;</style>`],
			[`<style>${body}<g/></style>`, `<style>${body}<g/></style>`],
			[`<style>${body}<!--c-->${body}</style>`, `<style>${body}${body}</style>`],
			[`<style>${body}</style2></style>`, `<style>${body}</style2></style>`],
			[`<style><![CDATA[${body}]]></style2></style>`, `<style><![CDATA[${body}]]></style2></style>`]
		];

		for (const [input, expected] of cases) expect(svg(`<svg>${input}</svg>`), input).toBe(`<svg>${expected}</svg>`);
	});

	it("an unclosed payload element leaves the rest as written (main already does this right)", () =>
	{
		expect(svg("<svg><style> a { } ")).toBe("<svg><style> a { } ");
		expect(svg("<svg><style><![CDATA[ a { } ")).toBe("<svg><style><![CDATA[ a { } ");
		expect(svg("<svg><style><![CDATA[ a { } ]]>")).toBe("<svg><style><![CDATA[ a { } ]]>");
	});

	it("a payload holding ]]> in plain text is not minified (red on main)", () =>
	{
		const input = "<svg><script>\nvar a = b[c[d]]>e;\n</script></svg>";

		expect(svg(input)).toBe(input);
	});

	it("diff r6: a clean payload whose minified form holds ]]> is not used (main already does this right)", () =>
	{
		const body = "a]]/**/>b{c:d}";
		const input = `${ROOT__}<style>${body}</style></svg>`;

		// premise: the body holds no "&", "<" or "]]>", and the CSS comment removal forms "]]>", so only the check
		// after minifying stands in the way
		expect((/[&<]|\]\]>/u).test(body)).toBe(false);
		expect(payload(body, "css")).toContain("]]>");

		expect(svg(input)).toBe(input);
	});

	it("diff r6: a script's CDATA that starts with #! keeps the whitespace before it, so it stays no hashbang (red on main)", () =>
	{
		// "#!" is a hashbang only as the script's first characters; the newline before the section keeps it an error
		const input = `${ROOT__}<script>\n<![CDATA[#! text\nconsole.log(1);]]>\n</script></svg>`;

		expect(svg(input)).toBe(`${ROOT__}<script>\n<![CDATA[#! text\nconsole.log(1);]]></script></svg>`);
		expect(svg(`${ROOT__}<script>\n<![CDATA[\n#! text\n]]></script></svg>`)).toBe(`${ROOT__}<script><![CDATA[\n#! text\n]]></script></svg>`);
	});

	it("diff r9: the whitespace after a payload's CDATA section is part of its text, so it ends inside the section (red on main)", () =>
	{
		// the stylesheet text is the section plus what follows it: a string left open by the section ends at that newline
		// (a bad string, its declaration dropped), where without it the end of the text closes the string (the declaration applies)
		const open = ".item::before{content:\"text";

		expect(svg(`${ROOT__}<style><![CDATA[${open}]]>\n</style></svg>`)).toBe(`${ROOT__}<style><![CDATA[${open}\n]]></style></svg>`);
		expect(svg(`${ROOT__}<style><![CDATA[a\\]]>\n</style></svg>`)).toBe(`${ROOT__}<style><![CDATA[a\\\n]]></style></svg>`);

		// controls: a complete payload loses it as before, with or without the section; text without one is as before
		expect(svg(`${ROOT__}<style><![CDATA[ a { b : c } ]]>\n</style></svg>`)).toBe(`${ROOT__}<style><![CDATA[ a{b:c}]]></style></svg>`);
		expect(svg(`${ROOT__}<style>\n<![CDATA[a { b : c }]]></style></svg>`)).toBe(`${ROOT__}<style><![CDATA[a{b:c}]]></style></svg>`);
		expect(svg(`${ROOT__}<style>${open}\n</style></svg>`)).toBe(`${ROOT__}<style>${open}\n</style></svg>`);
		expect(svg(`${ROOT__}<script><![CDATA[console.log(1) ]]>\n</script></svg>`)).toBe(`${ROOT__}<script><![CDATA[console.log(1)]]></script></svg>`);
	});
});

describe("SVG diff review round 10", () =>
{
	it("diff r10: a CDATA section that ends in CR, with a LF right after it, stays as written, since the minifier would read one CRLF line break where there were two (red on 22f8e71)", () =>
	{
		// the section's CR and the LF after it are two line breaks; joined, they are one
		const kept = `${ROOT__}<style><![CDATA[a\\\r]]>\n</style></svg>`;

		expect(svg(kept)).toBe(kept);

		const script = `${ROOT__}<script><![CDATA[var a = "b\\\r]]>\n</script></svg>`;

		expect(svg(script)).toBe(script);

		// controls: a LF at the end of the section, or a CR after it, join no two line breaks
		expect(svg(`${ROOT__}<style><![CDATA[a\\\n]]>\n</style></svg>`)).toBe(`${ROOT__}<style><![CDATA[a\\\n]]></style></svg>`);
		expect(svg(`${ROOT__}<style><![CDATA[a\\\r]]>\r</style></svg>`)).toBe(`${ROOT__}<style><![CDATA[a\\\r]]></style></svg>`);
		expect(svg(`${ROOT__}<style><![CDATA[a\\\r]]> \n</style></svg>`)).toBe(`${ROOT__}<style><![CDATA[a\\\r ]]></style></svg>`);
	});
});

describe("SVG with a DOCTYPE: tag whitespace and comments only", () =>
{
	it("conservative mode edits only inside tags and comments (red on main)", () =>
	{
		const input = "<?xml version=\"1.0\"?>\n<!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd\">\n<svg\nwidth = \"1.0\">\n  <!-- c -->\n  <rect x=\"0.50\"\n/>\n  <style> a { } </style>\n  <text>a  b</text>\n</svg>\n";

		expect(svg(input)).toBe("<?xml version=\"1.0\"?>\n<!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd\">\n<svg width=\"1.0\">\n  \n  <rect x=\"0.50\"/>\n  <style> a { } </style>\n  <text>a  b</text>\n</svg>\n");
	});

	it("an internal subset is read past its quoted literals, comments and PIs (red on main)", () =>
	{
		const subset = "<!DOCTYPE svg [\n<!ENTITY a \"x>]y\">\n<!ENTITY b 'q\"]>'>\n<!-- ]> -->\n<?pi ]>?>\n<!ATTLIST g id CDATA #IMPLIED>\n%pe;\n]>";
		const input = `${subset}\n<svg><!-- c --><g id = "a"/></svg>`;

		expect(svg(input)).toBe(`${subset}\n<svg><g id="a"/></svg>`);
	});

	it("a DOCTYPE anywhere, in any case, switches the mode (red on main)", () =>
	{
		expect(svg("<svg><!-- <!doctype --><rect width=\"1.0\"/>  </svg>")).toBe("<svg><rect width=\"1.0\"/>  </svg>");
	});

	it("a malformed DOCTYPE leaves the rest as written (red on main)", () =>
	{
		const cases = [
			"<!DOCTYPE svg \"x", "<!DOCTYPE svg [<!ENTITY a \"x", "<!DOCTYPE svg [<!-- x", "<!DOCTYPE svg [<?x",
			"<!DOCTYPE svg [<!ENTITY a", "<!DOCTYPE svg [", "<!DOCTYPE svg", "<!DOCTYPE svg [<!ENTITY a 'x' ] >", "<!DOCTYPE svg [ ' ]"
		];

		for (const doctype of cases)
		{
			const input = `${doctype} <svg> <g/> </svg>`;

			expect(svg(input), doctype).toBe(input);
		}

		expect(svg("<svg> <g/> </svg>\n<!DOCTYPE svg")).toBe("<svg> <g/> </svg>\n<!DOCTYPE svg");
	});
});

describe("SVG malformed markup: the rest stays as written", () =>
{
	it("each malformed construct latches (red on main)", () =>
	{
		const cases = [
			"<g", "<g a>", "<g a=b>", "<g a=\"b\"c=\"d\">", "<g a=\"b\" a=\"c\">", "<g a=\"<\">", "<g a=\"b>", "<g/ >", "< g>",
			"<1g>", "<-g>", "<.g>", "</svg>", "</ g>", "</h>", "</g", "<!x>", "<! x -->", "<!-- x", "<!-- x -- y", "<![CDATA[ x",
			"<?x", "<g a = >", "<! -- a -- b -->", "<"
		];

		for (const tail of cases)
		{
			const input = `<svg>\n<g>\n  <h/>${tail} <i>  </i> <!-- c -->`;

			expect(svg(input), tail).toBe(`<svg><g><h/>${tail} <i>  </i> <!-- c -->`);
		}

		// a lowercase doctype is not XML, and any doctype also puts the whole document in conservative mode
		expect(svg("<svg>\n<g>\n  <h/><!doctype svg> <i>  </i> <!-- c -->")).toBe("<svg>\n<g>\n  <h/><!doctype svg> <i>  </i> <!-- c -->");
	});

	it("diff r3: a comment XML rejects keeps the rest as written (red on main)", () =>
	{
		const root = "<svg xmlns=\"http://www.w3.org/2000/svg\">";

		for (const comment of ["<! --text-->", "<!--text-- >", "<! -- c -- \t>", "<!--  a -- b  -->", "<!-- <!-- x -->", "<!-- a --->"])
		{
			expect(svg(`${root} ${comment} <rect width="1.0"/> </svg>`), comment).toBe(`${root}${comment} <rect width="1.0"/> </svg>`);
		}

		// controls: well-formed comments, the empty one and one that holds "-" and "<!-" go as before
		expect(svg(`${root} <!----> <!-- a-b <!- c --> <rect width="1.0"/> </svg>`)).toBe(`${root}<rect width="1"/></svg>`);
	});

	it("diff r4, r5: a character XML forbids anywhere, or anything before the XML declaration, keeps the document as written (red on main)", () =>
	{
		const root = "<svg xmlns=\"http://www.w3.org/2000/svg\">";
		const inputs = [];

		for (const char of ["\u0000", "\u0001", "\u0008", "\u000B", "\u000C", "\u001F", "\uFFFE", "\uFFFF", "\uD800", "\uDC00", "a\uD800", "\uD800\uD801", "\uDBFF\uE000"])
		{
			inputs.push(`${root} <!-- a${char}b --> <rect width="1.0"/> </svg>`);
		}

		inputs.push(
			`${root} <g/> <\u0001> <g/> </svg>`,
			`${root}<text>a\u0000b</text> <rect width="1.0"/></svg>`,
			`${root}<rect id="a\u0000b" width="1.0"/></svg>`,
			`${root}<style><![CDATA[/*\u0000*/a{b:c}]]></style></svg>`,
			`${root}<style>/*\u0000*/a{b:c}</style></svg>`,
			`${root}<script>//\u0000\nf()</script></svg>`,
			`${root}<script>\u000Cf()</script></svg>`,
			`${root}<style>/* ]]> */a{b:c}</style></svg>`,
			`${root}<script>// ]]>\nf()</script></svg>`
		);

		for (const lead of [" ", "\n", "\r\n\t ", "<!-- c -->", "<!-- c -->\n"])
		{
			inputs.push(`${lead}<?xml version="1.0"?>\n${root}<rect width="1.0"/></svg>`);
		}

		inputs.push(
			`${root} <?xml version="1.0"?> <rect width="1.0"/> </svg>`,
			`${root} <?XML version="1.0"?> <rect width="1.0"/> </svg>`,
			`${root} <rect width="1.0"/> </svg><?xml?>`,
			`${root} <?x?> <?xml version="1.0"?> <rect width="1.0"/> </svg>`
		);

		for (const input of inputs) expect(svg(input), JSON.stringify(input)).toBe(input);

		// controls: tab, LF, CR, a surrogate pair and the last BMP characters are XML; a declaration at the start stays
		// and the rest is minified; space before other markup still goes, as does a PI whose name only starts with xml
		expect(svg(`${root} <!-- \t\n\r\uD83D\uDE00\uE000\uFFFD --> <rect width="1.0"/></svg>`)).toBe(`${root}<rect width="1"/></svg>`);
		expect(svg(`<?xml version="1.0"?>\n${root} <rect width="1.0"/></svg>`)).toBe(`<?xml version="1.0"?>${root}<rect width="1"/></svg>`);
		expect(svg(`\n<?xml-stylesheet href="a.css"?>\n${root}</svg>`)).toBe(`<?xml-stylesheet href="a.css"?>${root}</svg>`);
		expect(svg(`\n${root}<rect width="1.0"/></svg>`)).toBe(`${root}<rect width="1"/></svg>`);
	});
});

describe("SVG markers", () =>
{
	it("U+0001 in text, values, comments and payloads comes back as written, the whole document (red on main)", () =>
	{
		const input = "<svg>\u0001<g id=\"\u00010\u0001\"><text>\u00011\u0001</text><!-- 2 --><style>a{content:\"\u0001\"}</style></g>\u0001</svg>";

		// U+0001 is no XML character, so a document holding one comes back whole, as written (diff r5)
		expect(svg(input)).toBe(input);
		expect(svg("<svg> <g/> <!-- \u00012\u0001 --> <g/> </svg>")).toBe("<svg> <g/> <!-- \u00012\u0001 --> <g/> </svg>");
	});

	it("many markers next to number, comment and whitespace triggers (red on main)", () =>
	{
		const unit = "<rect x=\"0.50\" id=\"0.50\"/><text>1.0 </text><!---->\n";
		const input = `<svg>${unit.repeat(3000)}</svg>`;

		expect(svg(input)).toBe(`<svg>${"<rect x=\".5\" id=\"0.50\"/><text>1.0 </text>".repeat(3000)}</svg>`);
	});

	it("marker-like text in the input is restored as written (main already does this right)", () =>
	{
		const input = "<svg><text>\u00010\u0001\u00011\u0001</text><g id=\"\u0001\u0001\"/>\u0001\u0001</svg>";

		expect(svg(input)).toBe(input);
	});
});

describe("SVG scaling: every loop on long worst-case runs", () =>
{
	const cases = [
		[false, "whitespace between elements", () => `<svg>${" \n".repeat(LARGE__)}<g/>→</svg>`, () => "<svg><g/>→</svg>"],
		[false, "whitespace inside a tag", () => `<svg${" \t".repeat(LARGE__)}a="→"${"\n".repeat(LARGE__)}/>`, () => "<svg a=\"→\" />"],
		[true, "whitespace in a preserve scope", () => `<svg xml:space="preserve">${" ".repeat(LARGE__)}→</svg>`, () => `<svg xml:space="preserve">${" ".repeat(LARGE__)}→</svg>`],
		[false, "one huge number", () => `<svg width="1.${"5".repeat(LARGE__)}0" id="→"/>`, () => `<svg width="1.${"5".repeat(LARGE__)}" id="→"/>`],
		[true, "one huge zero fraction", () => `<svg width="0.${"0".repeat(LARGE__)}1" id="→"/>`, () => `<svg width=".${"0".repeat(LARGE__)}1" id="→"/>`],
		[false, "long path data", () => `<path id="→" d="M0 0${" L0.50,1.0".repeat(LARGE__ / 10)}"/>`, () => `<path id="→" d="M0 0${" L.5,1".repeat(LARGE__ / 10)}"/>`],
		[false, "long transform list", () => `<g id="→" transform="${"scale(1.0) ".repeat(LARGE__ / 11)}"/>`, () => `<g id="→" transform="${"scale(1) ".repeat(LARGE__ / 11)}"/>`],
		[true, "a path the self-check rejects", () => `<path id="→" d="M0 0${" L1.0.5".repeat(LARGE__ / 7)}"/>`, () => `<path id="→" d="M0 0${" L1.0.5".repeat(LARGE__ / 7)}"/>`],
		[false, "many attributes", () => `<svg a0="→"${Array.from({ length: LARGE__ / 10 }, (unused, index) => ` b${index}="1"`).join("")}/>`, () => `<svg a0="→"${Array.from({ length: LARGE__ / 10 }, (unused, index) => ` b${index}="1"`).join("")}/>`],
		[false, "deep nesting with prefixes", () => `<svg>${"<g xmlns:p=\"urn:→\">".repeat(LARGE__ / 20)}${"</g>".repeat(LARGE__ / 20)}</svg>`, () => `<svg>${"<g xmlns:p=\"urn:→\">".repeat(LARGE__ / 20)}${"</g>".repeat(LARGE__ / 20)}</svg>`],
		[false, "many comments", () => `<svg>${"<!-- → -->".repeat(LARGE__ / 10)}</svg>`, () => "<svg></svg>"],
		[false, "many unclosable comments", () => `<svg>${"<!-- -- → -->".repeat(LARGE__ / 13)}</svg>`, () => `<svg>${"<!-- -- → -->".repeat(LARGE__ / 13)}</svg>`],
		[false, "one long comment of XML characters (diff r4)", () => `<svg><!-- ${"→\uD83D\uDE00".repeat(LARGE__ / 3)} --></svg>`, () => "<svg></svg>"],
		[true, "many comments with a forbidden character (diff r4)", () => `<svg>${"<!-- →\u000C -->".repeat(LARGE__ / 11)}</svg>`, () => `<svg>${"<!-- →\u000C -->".repeat(LARGE__ / 11)}</svg>`],
		[true, "space before a late XML declaration (diff r4)", () => `${" ".repeat(LARGE__)}<?xml version="1.0"?><svg id="→"/>`, () => `${" ".repeat(LARGE__)}<?xml version="1.0"?><svg id="→"/>`],
		[true, "many PIs before a late XML declaration (diff r5)", () => `<svg> ${"<?x →?>".repeat(LARGE__ / 7)} <?xml version="1.0"?></svg>`, () => `<svg> ${"<?x →?>".repeat(LARGE__ / 7)} <?xml version="1.0"?></svg>`],
		[true, "many attributes named like handlers (diff r5)", () => `<svg width="1.0"${Array.from({ length: LARGE__ / 12 }, (unused, index) => ` on${index}="→"`).join("")}/>`, () => `<svg width="1.0"${Array.from({ length: LARGE__ / 12 }, (unused, index) => ` on${index}="→"`).join("")}/>`],
		[false, "a long value of near-attr text (diff r5)", () => `<svg width="1.0" class="${"att→".repeat(LARGE__ / 4)}"/>`, () => `<svg width="1" class="${"att→".repeat(LARGE__ / 4)}"/>`],
		[false, "comment openers without an end", () => `<svg>${"<!--→".repeat(LARGE__ / 5)}`, () => `<svg>${"<!--→".repeat(LARGE__ / 5)}`],
		[false, "an unclosed quote", () => `<svg a="${"→".repeat(LARGE__)}`, () => `<svg a="${"→".repeat(LARGE__)}`],
		[false, "many CDATA sections", () => `<svg>${"<![CDATA[→]]>".repeat(LARGE__ / 12)}</svg>`, () => `<svg>${"<![CDATA[→]]>".repeat(LARGE__ / 12)}</svg>`],
		[true, "many payloads", () => `<svg>${"<style> a { b: c } →</style>".repeat(LARGE__ / 28)}</svg>`, () => `<svg>${`<style>${payload(" a { b: c } →", "css")}</style>`.repeat(LARGE__ / 28)}</svg>`],
		[false, "many nested payload candidates", () => `<svg>${"<style><![CDATA[→]]>x".repeat(LARGE__ / 21)}`, () => `<svg>${"<style><![CDATA[→]]>x".repeat(LARGE__ / 21)}`],
		[false, "a DOCTYPE subset with many declarations", () => `<!DOCTYPE svg [${"<!ENTITY a \"→\">".repeat(LARGE__ / 15)}]><svg/>`, () => `<!DOCTYPE svg [${"<!ENTITY a \"→\">".repeat(LARGE__ / 15)}]><svg/>`],
		[true, "many text segments", () => `<svg>${"<text>a  →</text>\n".repeat(LARGE__ / 17)}</svg>`, () => `<svg>${"<text>a  →</text>".repeat(LARGE__ / 17)}</svg>`]
	];

	for (const [mainRed, name, build, expected] of cases)
	{
		it(`SVG scales: ${name} (${mainRed ? "red on main" : "main already does this right"})`, () =>
		{
			const input = build();
			const want = expected();
			let output = "";

			expect(input.length).toBeGreaterThanOrEqual(LARGE__ * 0.8);
			expect(cpuMs__(() =>
			{
				output = svg(input);
			})).toBeLessThan(CPU_LIMIT_MS__);
			expect(difference__(output, want)).toBeNull();
		}, SLOW_TEST_MS__);
	}
});
