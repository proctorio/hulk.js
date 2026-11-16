import minify__ from "../src/index.js";
import { cpuMs__, difference__ } from "./TestSupport.js";

// How minifyHtml__ (src/HtmlMinifier.js, src/HtmlTags.js, src/HtmlPayload.js) works. The notes live here, not in src:
// src keeps only the JSDoc the lint requires, and the build strips even that from the published copy.
//
// One scanner reads the document once, in order, the way the HTML tokenizer does (whitespace is [\t\n\f\r ], names
// are lowercased for A-Z only). It writes a "vaulted" copy: anything that must stay byte-exact is moved into the vault
// (src/Vault.js) and replaced by a marker, U+0001 + index + U+0001. Every U+0001 already in the input is vaulted as
// its own one-character span first, so every U+0001 in the vaulted copy belongs to a marker. Then today's stream rules
// run on the vaulted copy, and one restore puts every span back with a callback (no "$&" patterns, no
// __PRESERVE_BLOCK_n__ placeholders a document can collide with: H3, H6).
//
// What the scanner sees at each "<":
// - "<!--": a comment. It ends at "<!-->", "<!--->", the first "-->" or "--!>", or EOF. Both terminator searches are
//   cached, so many comments do not rescan the text. Comments go to the stream as written; the comment loop below
//   removes them, in one place (wi-47221 turns them into a marker).
// - "<!", "<?", "</" + non-letter: a bogus comment to the first ">", passed through.
// - "<!DOCTYPE" (any case): to its first ">", even inside a quoted identifier, as the tokenizer does, and vaulted whole
//   as a tag-like marker: a changed public identifier can change the document mode (diff r2).
// - "<![CDATA[" inside svg/math: vaulted to "]]>".
// - "<" + letter, "</" + letter: a tag. The attribute walk follows the tokenizer: a name runs to whitespace, "/", ">" or
//   "="; a quoted value to its quote; an unquoted value to whitespace or ">" (so <img src=x/> keeps its "/": H8).
//   Every value is vaulted (H2, H8). Inside the tag only, the spaces around "=" and before ">" are dropped (H2: the
//   old global "\s*=\s*" and "\s+>" rewrote text). Per attribute: an href/src value loses its quotes only when "=" and
//   the quote touch, the value has no [\t\n\f\r "'=<>`{}], and what follows is ">" or whitespace and another
//   attribute or ">", never a "/" that would join the value (H4); "/>" on a void element becomes ">". Mike's ruling
//   (diff r5): type="text/javascript", type="text/css" and attr="attr" stay as written, since a selector or a script can
//   read them.
// - Anything else: text.
//
// Element states:
// - script: script data with the escaped and double-escaped states, so "<!--", "<script>" and "</script>" inside a
//   script end it exactly where a browser does. style, xmp, iframe, noembed, noframes, noscript: raw text. textarea,
//   title: RCDATA. All end at "</name" + [\t\n\f\r />], ASCII case-insensitive, and their content is vaulted.
//   plaintext: the rest of the document is vaulted.
// - script, style and textarea become one tag-like marker, "<" + MARK..MARK + ">", so ">ws<" collapses around it as it
//   did around the old tags. A style payload goes through minifyCss__ when it has no type or type="text/css"; a script
//   payload through minifyJs__ when it is JavaScript (no type, "", a JavaScript MIME type, or exactly "module"), has
//   no language attribute and holds no "<!--". A minified payload that holds "</style" (style) or "</script" or
//   "<!--" (script) is thrown away and the payload kept as written (H1).
// - pre, code and listing: preserved blocks, vaulted whole as a text-like marker. Nesting counts the same name only;
//   comments, raw text and values inside do not close them, "</pre >" does (H7), and an unclosed one runs to EOF.
// - svg and math open foreign content: a stack of open foreign elements, no raw text there. An end tag pops to its
//   nearest match. A breakout tag (div, p, b, ..., and </p> </br>) leaves foreign content and is read as HTML.
//   Character data is vaulted, whitespace-only runs included, anywhere inside script, style, text, tspan, textPath,
//   title or desc (title and desc as the SVG minifier's S1 keeps them; a tag inside them latches, see below),
//   and in an xml:space scope: each element on the stack inherits its parent's xml:space, an xml:space attribute (the
//   first one) sets it, and only exactly "default" resets it (any other value, an entity included, preserves). The
//   SVG minifier's S1 rule, brought in by diff r2. Whitespace between other foreign elements collapses as before.
// - Latch: where the scanner cannot know the parser's state (a start tag or CDATA inside an integration point such as
//   foreignObject/title/desc/mi/annotation-xml, or a foreign end tag with no open match, or a tag cut off by EOF),
//   the rest of the document is vaulted verbatim from that tag on.
// - Gate: if the raw input holds "<select", "<frameset", "<noscript" or "<col" (any case), no payload is minified:
//   those can make the parser ignore a script or style start tag. Everything else assumes scripting on, so noscript is
//   raw text. In such a gated document, raw text that holds a state-changing tag latches from its start tag (diff r1).
// - Ignored foreign root: if the raw input holds "<select", "<frameset" or "<col" (not "<noscript": with scripting on
//   it cannot make the parser ignore an svg), the parser may ignore <svg>/<math>, so what follows is HTML. There, a
//   start tag of script, style, xmp, iframe, noembed, noframes, noscript, textarea, title or plaintext in foreign
//   content, or a CDATA section, latches the rest (diff r2).
//
// Whitespace, all with HTML whitespace and in one linear pass over the output parts. The scan notes the kind of each
// part (gap = whitespace-only text, tag, note = comment or bogus comment, doctype); a gap is dropped when it sits
// between two tags (tag or vaulted element marker, a DOCTYPE in the prolog), with comments between them transparent;
// text, a vaulted construct, a latch or CDATA break the chain, and a document start or end is not a boundary (H5 is
// kept: "<b>x</b> <i>y</i>" still loses its space). Then, unless the document mentions white-space (or the scan found
// a style that may spell it with an escape or a character reference: the gate), a line feed or tab, or a run of two or
// more whitespace characters, becomes one space; then trim, the comment loop (stripHtmlCommentsOnce__ to a fixed point),
// trim, restore. A gated document keeps its text whitespace as written, apart from the gaps.
//
// Expected payloads are computed with minify__(payload, "css"/"js") because the CSS and JS minifiers change in the
// same work item; a few literal ones pin outputs both versions agree on.

// A bound for linear time, not a benchmark: the CI agent runs these inputs 4 to 6 times slower than a laptop (the same row took
// 3082 ms there against 540 ms here), and a quadratic loop on 524288 repeats takes minutes, so 10 s still fails it.
const BOUND_MS__ = 10000;
const REPEAT__ = 524288;
const TIMEOUT_MS__ = 120000;

const html = text => minify__(text, "html");
const css = text => minify__(text, "css");
const js = text => minify__(text, "js");

/**
 * @description Asserts that minify__ would change a payload, so that a test showing it kept proves something.
 * @param {string} payload - Script or style text.
 * @param {string} language - "js" or "css".
 * @return {void}
 */
function expectChangeable(payload, language)
{
	expect(minify__(payload, language)).not.toBe(payload);
}

/**
 * @description Asserts an HTML input comes back exactly as it went in, after showing the payload in it would be minified.
 * @param {string} input - HTML.
 * @param {?string} payload - The payload a careless minifier would rewrite, or null.
 * @param {string} language - "js" or "css".
 * @return {void}
 */
function expectKept(input, payload, language)
{
	if (payload !== null) expectChangeable(payload, language);

	expect(html(input)).toBe(input);
}

describe("HTML plan cases (each red on main)", () =>
{
	it("H1: an inline script keeps its line structure; a // comment no longer eats the code after it", () =>
	{
		const payload = "\n// c\nfoo();\n";

		expect(html(`<script>${payload}</script>`)).toBe(`<script>${js(payload)}</script>`);
		expect(html(`<script>${payload}</script>`)).toBe("<script>foo();</script>");
	});

	it("H1: an inline style is minified as CSS", () =>
	{
		const payload = "\na  {  color : red }\n";

		expect(html(`<style>${payload}</style>`)).toBe(`<style>${css(payload)}</style>`);
		expect(html(`<style>${payload}</style>`)).toBe("<style>a{color:red}</style>");
		expect(html("<style>\n.a\n.b{fill:red}\n</style>")).toBe(`<style>${css("\n.a\n.b{fill:red}\n")}</style>`);
	});

	it("H1: a textarea keeps its text", () =>
	{
		expect(html("<textarea>a\n  b</textarea>")).toBe("<textarea>a\n  b</textarea>");
		expect(html("<p>x</p>\n<textarea  rows = \"2\" >\n\ta\n</textarea >\n<p>y</p>")).toBe("<p>x</p><textarea rows=\"2\">\n\ta\n</textarea><p>y</p>");
	});

	it("H1: JSON and template scripts stay verbatim", () =>
	{
		expectKept("<script type=\"application/json\">{ \"a\" : 1 }\n</script>", null, "js");
		expectKept("<script type=\"application/ld+json\">\n{ \"a\": 1 }\n</script>", null, "js");
		expectKept("<script type=\"text/template\"><div>  x  </div>\n// y\n</script>", "// y\n", "js");
		expectKept("<script type=\"importmap\">\n{ \"imports\": {} }\n</script>", null, "js");
	});

	it("H1: the payload is minified, its type kept since diff r5", () =>
	{
		expect(html("<script type=\"text/javascript\">\n// c\nfoo();\n</script>")).toBe(`<script type="text/javascript">${js("\n// c\nfoo();\n")}</script>`);
		expect(html("<style type=\"text/css\">\na { color : red }\n</style>")).toBe(`<style type="text/css">${css("\na { color : red }\n")}</style>`);
		expect(html("<script type=\"module\"> //keep\nfoo()</script>")).toBe(`<script type="module">${js(" //keep\nfoo()")}</script>`);
		expect(html("<script type=\" text/javascript \">//c\nfoo()</script>")).toBe(`<script type=" text/javascript ">${js("//c\nfoo()")}</script>`);
		expect(html("<script type=\"\">//c\nfoo()</script>")).toBe(`<script type="">${js("//c\nfoo()")}</script>`);
		expect(html("<script type>//c\nfoo()</script>")).toBe(`<script type>${js("//c\nfoo()")}</script>`);
	});

	it("H1: a minified payload that would end its element early is thrown away", () =>
	{
		const script = "<script>const s=\"</script\u00A0>\";\n// c\nfoo();</script>";
		const style = "<style>a{b:x</**//StYlE>}</style><p>kept</p>";

		expectChangeable("const s=\"</script\u00A0>\";\n// c\nfoo();", "js");
		expect(js("const s=\"</script\u00A0>\";\n// c\nfoo();")).toContain("</script");
		expect(html(script)).toBe(script);
		expectChangeable("a{b:x</**//StYlE>}", "css");
		expect(css("a{b:x</**//StYlE>}").toLowerCase()).toContain("</style");
		expect(html(style)).toBe(style);
		expect(html("<style>a{--x:</**//StYlE>}</style><p>kept</p>")).toBe("<style>a{--x:</**//StYlE>}</style><p>kept</p>");
	});

	it("H1: a script holding \"<!--\" stays verbatim (escaped script data)", () =>
	{
		const input = "<script><!--\nvar a = \"<script>\";\nvar b = \"</script>\";\nvar t = `x\n//keep\ny`;\n--></script><p>after</p>";

		expectKept(input, "var a = 1;\n// c\n", "js");
	});

	it("H2: \"=\" spacing, \">\" spacing and runs inside text and values are kept", () =>
	{
		expect(html("<p>a = b</p>")).toBe("<p>a = b</p>");
		expect(html("<input value=\"a  =  b\">")).toBe("<input value=\"a  =  b\">");
		expect(html("<div title=\"a   b\">x</div>")).toBe("<div title=\"a   b\">x</div>");
		expect(html("<p>a > b</p>")).toBe("<p>a > b</p>");
		expect(html("<p>a\u00A0\u00A0b</p>")).toBe("<p>a\u00A0\u00A0b</p>");
		expect(html("\u00A0<p>a</p>\u00A0")).toBe("\u00A0<p>a</p>\u00A0");
		expect(html("<p>a  \n b</p>")).toBe("<p>a b</p>");
	});

	it("H2, main already does this right: inside a tag, spaces around \"=\" and before \">\" still go", () =>
	{
		expect(html("<div class = \"a\"  id= 'b' >x</div >")).toBe("<div class=\"a\" id='b'>x</div>");
		expect(html("<div\n\tclass=\"a\"\n>x</div>")).toBe("<div class=\"a\">x</div>");
	});

	it("H3: a literal __PRESERVE_BLOCK_n__ survives", () =>
	{
		expect(html("<pre>x</pre><p>__PRESERVE_BLOCK_0__</p>")).toBe("<pre>x</pre><p>__PRESERVE_BLOCK_0__</p>");
		expect(html("<p>__PRESERVE_BLOCK_0__</p><pre> a </pre>")).toBe("<p>__PRESERVE_BLOCK_0__</p><pre> a </pre>");
		expect(html("<pre>__PRESERVE_BLOCK_0__</pre>")).toBe("<pre>__PRESERVE_BLOCK_0__</pre>");
	});

	it("H4: href/src keep quotes a bare value cannot do without", () =>
	{
		expect(html("<a href=\"/x>y\">x</a>")).toBe("<a href=\"/x>y\">x</a>");
		expect(html("<a href=\"a\"b\">x</a>")).toBe("<a href=\"a\"b\">x</a>");
		expect(html("<a href=\"x\"id=\"y\">x</a>")).toBe("<a href=\"x\"id=\"y\">x</a>");
		expect(html("<a href=\"{{url}}\">x</a>")).toBe("<a href=\"{{url}}\">x</a>");
		expect(html("<img src=\"a=b\">")).toBe("<img src=\"a=b\">");
		expect(html("<a href=\"a`b\">x</a>")).toBe("<a href=\"a`b\">x</a>");
	});

	it("H4: quotes still go where a bare value is the same", () =>
	{
		expect(html("<a href=\"/x\">x</a>")).toBe("<a href=/x>x</a>");
		expect(html("<a href='/x' id=\"y\">x</a>")).toBe("<a href=/x id=\"y\">x</a>");
		expect(html("<a href=\"/x\" >x</a>")).toBe("<a href=/x>x</a>");
		expect(html("<img src=\"a.png\" />")).toBe("<img src=a.png>");
		expect(html("<img src=\"a.png\"/>")).toBe("<img src=a.png>");
		expect(html("<a href=\"a\u00A0b\">x</a>")).toBe("<a href=a\u00A0b>x</a>");
		expect(html("<a href=\"a b\">x</a>")).toBe("<a href=\"a b\">x</a>");
	});

	it("H4: quotes stay before a \"/\" that would join the value", () =>
	{
		expect(html("<a href=\"/x\"/>")).toBe("<a href=\"/x\"/>");
		expect(html("<a href=\"/x\" />")).toBe("<a href=\"/x\" />");
		expect(html("<img src=\"/x\" / >")).toBe("<img src=\"/x\" / >");
		expect(html("<svg><use href=\"#i\"/></svg>")).toBe("<svg><use href=\"#i\"/></svg>");
	});

	it("H5 (documented, not fixed), main already does this right: whitespace between inline elements still goes", () =>
	{
		// main already does this, and the plan keeps it
		expect(html("<b>x</b> <i>y</i>")).toBe("<b>x</b><i>y</i>");
	});

	it("H6: \"$&\" and \"$$\" in a preserved block survive", () =>
	{
		expect(html("<pre>$&</pre>")).toBe("<pre>$&</pre>");
		expect(html("<pre>$$</pre>")).toBe("<pre>$$</pre>");
		expect(html("<code>$'$`</code>")).toBe("<code>$'$`</code>");
	});

	it("H7: preserved blocks end where the parser ends them", () =>
	{
		expect(html("<pre>a  b</pre >\n<p>c</p>")).toBe("<pre>a  b</pre > <p>c</p>");
		expect(html("<code><code>a</code>  b</code>")).toBe("<code><code>a</code>  b</code>");
		expect(html("<pre><!-- </pre> --> a  b</pre>")).toBe("<pre><!-- </pre> --> a  b</pre>");
		expect(html("<pre><script>const s=\"</pre>\";</script> a  b</pre>")).toBe("<pre><script>const s=\"</pre>\";</script> a  b</pre>");
		expect(html("<pre title=\"</pre>\"> a  b</pre>")).toBe("<pre title=\"</pre>\"> a  b</pre>");
		expect(html("<listing> a  b</listing>")).toBe("<listing> a  b</listing>");
		expect(html("<p>x</p>\n<pre> a  b")).toBe("<p>x</p> <pre> a  b");
		expect(html("<PRE> a  b</Pre>")).toBe("<PRE> a  b</Pre>");
	});

	it("H8: the void-slash rule stays out of values", () =>
	{
		expect(html("<img src=x/>")).toBe("<img src=x/>");
		expect(html("<img alt=\"a /> b\">")).toBe("<img alt=\"a /> b\">");
		expect(html("<div data-x=<!--foo-->x>text</div>")).toBe("<div data-x=<!--foo-->x>text</div>");
	});

	it("payload latch: after a foreign end tag with no match, the rest stays byte for byte", () =>
	{
		const input = "<div><svg></div><textarea><!--x-->A</textarea>";

		expect(html("<p>x</p><textarea><!--x-->A</textarea>\n<!--y-->")).toBe("<p>x</p><textarea><!--x-->A</textarea>");
		expect(html(input)).toBe(input);
		expect(html("<p>x</p>\n<div><svg></div><p>a  b</p>")).toBe("<p>x</p><div><svg></div><p>a  b</p>");
	});
});

describe("HTML element content", () =>
{
	it("script data ends where browsers end it, through the escaped and double-escaped states", () =>
	{
		expect(html("<script><!--<script>a</script>  b</script>\n<p>x  y</p>")).toBe("<script><!--<script>a</script>  b</script><p>x y</p>");
		expect(html("<script><!--<script>--></script>  <p>x  y</p>")).toBe("<script><!--<script>--></script><p>x y</p>");
		expect(html("<script><!--</script>  <p>x  y</p>")).toBe("<script><!--</script><p>x y</p>");
		expect(html("<script><!--><p>  </p></script>")).toBe("<script><!--><p>  </p></script>");
		expect(html("<script>a</SCRIPT\t>  <p>x  y</p>")).toBe("<script>a</SCRIPT><p>x y</p>");
		expect(html("<script>a</scripts>  b</script>")).toBe(`<script>${js("a</scripts>  b")}</script>`);
	});

	it("raw text and RCDATA are kept as written", () =>
	{
		expect(html("<noscript><p>a  b</p></noscript>")).toBe("<noscript><p>a  b</p></noscript>");
		expect(html("<iframe> a  <!--b--> </iframe>")).toBe("<iframe> a  <!--b--> </iframe>");
		expect(html("<noembed> a  b </noembed><noframes> c  d </noframes>")).toBe("<noembed> a  b </noembed><noframes> c  d </noframes>");
		expect(html("<title> My  page </title>")).toBe("<title> My  page </title>");
		expect(html("<plaintext>a  <b>  c</plaintext>")).toBe("<plaintext>a  <b>  c</plaintext>");
		expect(html("<xmp> a </xmp ><xmp></xmp>")).toBe("<xmp> a </xmp><xmp></xmp>");
	});

	it("an element or tag cut off by the end of the document is kept as written", () =>
	{
		expect(html("<p>a  b</p>\n<script>//c\nfoo()")).toBe(`<p>a b</p><script>${js("//c\nfoo()")}`);
		expect(html("<p>a  b</p>\n<textarea> x  y")).toBe("<p>a b</p><textarea> x  y");
		expect(html("<p>a  b</p>\n<textarea> x  y</textarea  id=\"1")).toBe("<p>a b</p><textarea> x  y</textarea  id=\"1");
		expect(html("<p>a  b</p><a href=\"x  y")).toBe("<p>a b</p><a href=\"x  y");
		expect(html("<p>a  b</p><a  href")).toBe("<p>a b</p><a  href");
	});

	it("main does the same, pinned residual (wi-47221): a comment ended by \"--!>\" runs to a later \"-->\"", () =>
	{
		expect(html("<!--a--!><p>x</p><!--b-->")).toBe("");
	});
});

describe("HTML type and boolean attributes", () =>
{
	it("diff r5: a script or style keeps its type in HTML, SVG and MathML, since a selector or script can read it (red on main)", () =>
	{
		for (const input of [
			"<SCRIPT type='TEXT/JAVASCRIPT'>x</SCRIPT>",
			"<script type=\"text/javascript\">console.log(document.currentScript.type)</script>",
			"<script type=text/javascript>x</script>",
			"<svg><style type=\"text/css\">.a{fill:red}</style></svg>",
			"<math><script type=\"text/javascript\">1</script></math>",
			"<math><style type=\"text/css\">a</style></math>",
			"<math><svg><style type=\"text/css\">a</style></svg></math>"
		]) expect(html(input), input).toBe(input);

		expect(html("<script type=\"text/javascript\" src=\"a.js\"></script>")).toBe("<script type=\"text/javascript\" src=a.js></script>");
		expect(html("<script type=\"text/javascript\"src=\"a.js\"></script>")).toBe("<script type=\"text/javascript\"src=a.js></script>");
		expect(html("<svg><style type=\"text/css\">style[type=\"text/css\"] + rect{fill:red}</style><rect width=\"10\" height=\"10\"/></svg>")).toBe(`<svg><style type="text/css">${css("style[type=\"text/css\"] + rect{fill:red}")}</style><rect width="10" height="10"/></svg>`);
	});

	it("diff r5: a boolean attribute keeps its value, since a selector or script can read it (red on main)", () =>
	{
		for (const input of [
			"<input checked=\"checked\" disabled='DISABLED'>",
			"<input checked=\"checked\" id=\"x\">",
			"<input checked=checked>",
			"<input value=\"x\"checked=\"checked\">",
			"<input value=\"checked\" checked=\"\">",
			"<svg checked=\"checked\"><rect width=\"10\" height=\"10\"/></svg>",
			"<math disabled=\"disabled\"><mi>x</mi></math>"
		]) expect(html(input), input).toBe(input);
	});

	it("the type stays with a language attribute or a second type", () =>
	{
		expectKept("<script type=\"text/javascript\" language=json> //keep\nfoo()</script>", " //keep\nfoo()", "js");
		expectKept("<script type=\"text/javascript\" type=\"application/json\">foo()\n// c\n</script>", "foo()\n// c\n", "js");
	});

	it("main already does this right: a data block is not minified", () =>
	{
		expectKept("<script language=json> //keep</script>", " //keep", "js");
		expectKept("<script type=\"module \"> //keep</script>", " //keep", "js");
		expectKept("<script type=\" module\"> //keep</script>", " //keep", "js");
		expectKept("<style type=\"text/less\">a { b: c }</style>", "a { b: c }", "css");
	});

	it("the void rule stays out of foreign content", () =>
	{
		expect(html("<svg><x checked=\"checked\"/><input/></svg>")).toBe("<svg><x checked=\"checked\"/><input/></svg>");
		expect(html("<svg><p><input/></svg>")).toBe("<svg><p><input></svg>");
	});

	it("a stray \"/\" before \">\" keeps its space", () =>
	{
		expect(html("<br / >")).toBe("<br / >");
		expect(html("<svg><g / ></g></svg>")).toBe("<svg><g / ></g></svg>");
	});
});

describe("HTML main already does this right (r1 controls)", () =>
{
	it("keeps the space before a code block and separators as written", () =>
	{
		expect(html("<b>x</b> <code>y</code>")).toBe("<b>x</b> <code>y</code>");
		expect(html("<input class=\"x\"id=\"y\">")).toBe("<input class=\"x\"id=\"y\">");
		expect(html("<pre title = \"x\" > a </pre>")).toBe("<pre title = \"x\" > a </pre>");
		expect(html("<a data-href=\"/x\">x</a>")).toBe("<a data-href=/x>x</a>");
	});

	it("keeps svg script text and xmp text", () =>
	{
		expect(html("<svg><script>//comment&#10;alert(1)</script></svg>")).toBe("<svg><script>//comment&#10;alert(1)</script></svg>");
		expectKept("<xmp><style>a { color:red }</style></xmp>", "a { color:red }", "css");
		expectKept("<?bogus <script>//comment</script> ?>", "//comment", "js");
	});

	it("reads a lone \"<\" as text", () =>
	{
		expect(html("a < b")).toBe("a < b");
		expect(html("<3")).toBe("<3");
		expect(html("<<b>x</b>")).toBe("<<b>x</b>");
		expect(html("</>")).toBe("</>");
		expect(html("</3>")).toBe("</3>");
		expect(html("a </")).toBe("a </");
	});

	it("removes comments and the whitespace around a DOCTYPE as before", () =>
	{
		expect(html("<p>1</p><!--a--><p>2</p>\n<!-- b -->\n<p>3</p>")).toBe("<p>1</p><p>2</p><p>3</p>");
		expect(html("<!DOCTYPE html>\n<html>\n  <body>\n</body></html>")).toBe("<!DOCTYPE html><html><body></body></html>");
		expect(html("<div>  <p>  Hello  </p>  </div>")).toBe("<div><p> Hello </p></div>");
	});

	it("main does the same, pinned residual (wi-47221): a bogus comment holding \"<!--\" joins a later \"-->\"", () =>
	{
		expect(html("<p>x</p><!<!---->--<pre> a </pre>--><p>y</p>")).toBe("<p>x</p><p>y</p>");
	});
});

describe("HTML reviewer probes: payloads that are minified", () =>
{
	const STYLE__ = "/*keep*/a{color:red}";
	const minifiedStyle = `<style>${css(STYLE__)}</style>`;

	it("positive control, main already does this right: the payload the probes use is minified", () =>
	{
		expectChangeable(STYLE__, "css");
		expect(minifiedStyle).toBe("<style>a{color:red}</style>");
	});

	it("r1: a comment ended by \"<!-->\" or \"--!>\" does not hide the script after it", () =>
	{
		const payload = "let t=`a\n//keep\nb`;";

		expect(html(`<!--><script>${payload}</script>`)).toBe(`<!--><script>${js(payload)}</script>`);
		expect(html(`<!--x--!><script>${payload}</script>`)).toBe(`<!--x--!><script>${js(payload)}</script>`);
	});

	it("r6: style after a breakout, in a table, and after a self-closed script or style", () =>
	{
		expect(html("<svg><g><p><style>a { x: 0px }</style></p></g></svg>")).toBe(`<svg><g><p><style>${css("a { x: 0px }")}</style></p></g></svg>`);
		expect(html("<table><style>a { color: red }</style></table>")).toBe(`<table><style>${css("a { color: red }")}</style></table>`);
		expect(html("<table><style>a { color: red }</style></table>")).toBe("<table><style>a{color:red}</style></table>");
		expect(html("<script/> //keep<script>foo()</script>")).toBe(`<script/>${js(" //keep<script>foo()")}</script>`);
		expect(html("<style/>a { color:red }</style>")).toBe(`<style/>${css("a { color:red }")}</style>`);
		expect(html("<style>a{--x:[[]]/**/>}</style>")).toBe(`<style>${css("a{--x:[[]]/**/>}")}</style>`);
		expect(css("a{--x:</**/StYlE>}").toLowerCase()).not.toContain("</style");
		expect(html("<style>a{--x:</**/StYlE>}</style>")).toBe(`<style>${css("a{--x:</**/StYlE>}")}</style>`);
	});

	it("r7, r12: script and style in body, table, template, tr, td and option", () =>
	{
		const payload = "//keep\nfoo()";

		expect(html(`<html><body><script>${payload}</script></body></html>`)).toBe(`<html><body><script>${js(payload)}</script></body></html>`);
		expect(html(`<html><body><table><script>${payload}</script></table></body></html>`)).toBe(`<html><body><table><script>${js(payload)}</script></table></body></html>`);
		expect(html(`<html><body><template><script>${payload}</script></template></body></html>`)).toBe(`<html><body><template><script>${js(payload)}</script></template></body></html>`);
		expect(html(`<template><tr><style>${STYLE__}</style></template>`)).toBe(`<template><tr>${minifiedStyle}</template>`);
		expect(html(`<template><td><style>${STYLE__}</style></template>`)).toBe(`<template><td>${minifiedStyle}</template>`);
		expect(html(`<option><style>${STYLE__}</style>`)).toBe(`<option>${minifiedStyle}`);
		expect(html("<tr><script>/*keep*/</script>")).toBe(`<tr><script>${js("/*keep*/")}</script>`);
	});

	it("r8, r13, r15: style payloads the CSS minifier handles", () =>
	{
		for (const payload of [
			"a{margin:0px.5em}",
			"a{--x:#aabbcc;color:if(style(--x:#aabbcc):red;else:blue)}",
			"keep{opacity:1;opacity:0px}",
			"@container style(--keep:{1;}){p{opacity:0}}",
			"p{opacity:1;opacity:0px}"
		])
		{
			expect(html(`<style>${payload}</style><p>keep</p>`)).toBe(`<style>${css(payload)}</style><p>keep</p>`);
		}
	});

	it("r10, r11: a DOCTYPE ends at its first \">\", so the style after it is real", () =>
	{
		expect(html(`<!DOCTYPE html PUBLIC "x><style>${STYLE__}</style>"><p>x`)).toBe(`<!DOCTYPE html PUBLIC "x>${minifiedStyle}"><p>x`);
		expect(html(`<!DOCTYPE html PUBLIC "x><style>${STYLE__}</style>">`)).toBe(`<!DOCTYPE html PUBLIC "x>${minifiedStyle}">`);
		expect(html(`<!DOCTYPE html SYSTEM "><xmp>"><textarea></xmp><style>${STYLE__}</style></textarea>`)).toBe(`<!DOCTYPE html SYSTEM "><xmp>"><textarea></xmp>${minifiedStyle}</textarea>`);
		expect(html(`<!DOCTYPE html PUBLIC "><xmp>"><textarea></xmp><style>${STYLE__}</style></textarea>`)).toBe(`<!DOCTYPE html PUBLIC "><xmp>"><textarea></xmp>${minifiedStyle}</textarea>`);
	});

	it("r12: an svg title that is closed, or closed by </svg>, leaves the style after it real", () =>
	{
		expect(html(`<div><b></div><svg><title>keep</title></svg><style>${STYLE__}</style>`)).toBe(`<div><b></div><svg><title>keep</title></svg>${minifiedStyle}`);
		expect(html(`<p><b></p><svg><title>keep</svg><style>${STYLE__}</style>`)).toBe(`<p><b></p><svg><title>keep</svg>${minifiedStyle}`);
		expect(html(`<p><b></p><svg><title>keep</title></svg><style>${STYLE__}</style>`)).toBe(`<p><b></p><svg><title>keep</title></svg>${minifiedStyle}`);
	});

	it("r14: a &#10; in an HTML script is not a line break", () =>
	{
		expect(html("<script>//keep&#10;keep=1</script>")).toBe(`<script>${js("//keep&#10;keep=1")}</script>`);
		expect(html("<script>//keep&#10;keep=1</script>")).toBe("<script></script>");
	});
});

describe("HTML reviewer probes: gated documents (main already does this right: main minifies no payload)", () =>
{
	const cases = [
		["r6 select", "<select><style>a { color: red }</style></select>", "a { color: red }", "css"],
		["r6 select option", "<select><option><style>/*keep*/a{color:red}</style></option></select>", "/*keep*/a{color:red}", "css"],
		["r7 frameset script", "<frameset><script>//<frame src=x></script></frameset>", "//<frame src=x>", "js"],
		["r7 frameset style", "<frameset><style>/*<frame src=x>*/</style></frameset>", "/*<frame src=x>*/", "css"],
		["r7 select template", "<select><template></select></template><style>/*keep*/a{color:red}</style></select>", "/*keep*/a{color:red}", "css"],
		["r7 select template select", "<select><template><select></select></template><style>/*keep*/a{color:red}</style></select>", "/*keep*/a{color:red}", "css"],
		["r7 select xmp", "<select><xmp><style>/*keep*/a{color:red}</style></xmp></select>", "/*keep*/a{color:red}", "css"],
		["r7 select script", "<select><script>//keep</script></select>", "//keep", "js"],
		["r7 html frameset", "<html><frameset><script>//<frame src=x></script></frameset></html>", "//<frame src=x>", "js"],
		["r7 select template option", "<select><template></select></template><option><style>/*keep*/a{color:red}</style></option></select>", "/*keep*/a{color:red}", "css"],
		["r8 head noscript frameset script", "<head><noscript><frameset></noscript><script>//<frame src=x></script>", "//<frame src=x>", "js"],
		["r8 noscript select", "<noscript><select></noscript><style>/*keep*/a{color:red}</style>", "/*keep*/a{color:red}", "css"],
		["r8 head noscript frameset style", "<head><noscript><frameset></noscript><style>/*keep*/a{color:red}</style>", "/*keep*/a{color:red}", "css"],
		["r8 noscript frameset", "<noscript><frameset></noscript><script>//<frame src=x></script>", "//<frame src=x>", "js"],
		["r8 select xmp script", "<select><xmp></select><script>//keep</script></xmp><script>//keep</script>", "//keep", "js"],
		["r8 svg script select", "<svg><script></svg><select></script><style>/*keep*/a{color:red}</style>", "/*keep*/a{color:red}", "css"],
		["r8 svg style select", "<svg><style></svg><select></style><style>/*keep*/a{color:red}</style>", "/*keep*/a{color:red}", "css"],
		["r8 svg title select", "<svg><title><select></title></svg><style>/*keep*/a{color:red}</style>", "/*keep*/a{color:red}", "css"],
		["r8 template col style", "<template><col><style>/*keep*/a{color:red}</style></template>", "/*keep*/a{color:red}", "css"],
		["r8 template col script", "<template><col><script>//<col span=2></script></template>", "//<col span=2>", "js"],
		["r8 template colgroup col", "<template><colgroup></colgroup><col><script>//<col span=2></script></template>", "//<col span=2>", "js"],
		["r8 template col style p", "<template><col><style>/*keep*/a{color:red}</style><p>x</p></template>", "/*keep*/a{color:red}", "css"],
		["r8 table colgroup", "<table><colgroup><script>//<col span=2></script></colgroup></table>", "//<col span=2>", "js"],
		["r9 body noscript div title", "<body><noscript><div title=\"</noscript><style>/*keep*/a{color:red}</style>\"></div></noscript>", "/*keep*/a{color:red}", "css"],
		["r9 noscript textarea", "<noscript><textarea></noscript><style>/*keep*/a{color:red}</style></textarea></noscript>", "/*keep*/a{color:red}", "css"],
		["r9 SELECT", "<SELECT><style>/*keep*/a{color:red}</style>", "/*keep*/a{color:red}", "css"],
		["r10 body noscript textarea", "<body><noscript><textarea></noscript><style>/*keep*/a{color:red}</style></textarea></noscript>", "/*keep*/a{color:red}", "css"],
		["r12 col script", "<col><script>//<col span=2></script>", "//<col span=2>", "js"],
		["r12 col style", "<col><style>/*keep*/a{color:red}</style>", "/*keep*/a{color:red}", "css"],
		["r12 colgroup", "<colgroup><script>//<col span=2></script></colgroup>", "//<col span=2>", "js"],
		["r13 col style comment", "<col><style>/*<col span=2>*/</style>", "/*<col span=2>*/", "css"],
		["r15 noscript textarea", "<noscript><textarea></noscript><style>/*keep*/</style></textarea></noscript>", "/*keep*/", "css"]
	];

	for (const [name, input, payload, language] of cases)
	{
		it(name, () =>
		{
			expectKept(input, payload, language);
		});
	}
});

describe("HTML reviewer probes: latched or RCDATA documents (main already does this right: main minifies no payload)", () =>
{
	const STYLE__ = "/*keep*/a{color:red}";
	const cases = [
		["r6 foreignObject style", "<svg><foreignObject><style>a { x: 0px }</style></foreignObject></svg>", "a { x: 0px }", "css"],
		["r6 annotation-xml script", "<math><annotation-xml encoding=\"text/html\"><script>const s=\"&amp;\";</script></annotation-xml></math>", null, "js"],
		["r6 svg script with &#10;", "<svg><g><script>const x=1&#10; //keep</script></g></svg>", null, "js"],
		["r9 foreignObject div", "<svg><foreignObject><div></svg></div></foreignObject><script>//c&#10;alert(1)</script></svg>", "//c&#10;alert(1)", "js"],
		["r10 svg p textarea", `<svg><p><textarea></svg><style>${STYLE__}</style></textarea>`, STYLE__, "css"],
		["r10 math p textarea", `<math><p><textarea></math><style>${STYLE__}</style></textarea>`, STYLE__, "css"],
		["r10 svg /p textarea", `<svg></p><textarea></svg><style>${STYLE__}</style></textarea>`, STYLE__, "css"],
		["r10 svg /br textarea", `<svg></br><textarea></svg><style>${STYLE__}</style></textarea>`, STYLE__, "css"],
		["r11 svg p textarea to EOF", `<svg><p><textarea></svg><style>${STYLE__}</style>`, STYLE__, "css"],
		["r11 foreignObject div", "<svg><foreignObject><div></svg></div></foreignObject><script>//keep&#10;1</script></svg>", "//keep&#10;1", "js"],
		["r11 div svg", `<div><svg></div><textarea></svg><style>${STYLE__}</style></textarea>`, STYLE__, "css"],
		["r11 div math", `<div><math></div><textarea></math><style>${STYLE__}</style></textarea>`, STYLE__, "css"],
		["r11 h1 svg", `<h1><svg></h1><textarea></svg><style>${STYLE__}</style></textarea>`, STYLE__, "css"],
		["r11 table svg", `<table><svg></table><textarea></svg><style>${STYLE__}</style></textarea>`, STYLE__, "css"],
		["r13 title CDATA", "<svg><title><![CDATA[><textarea>]]></title></svg><style>/*keep*/</style></textarea>", "/*keep*/", "css"],
		["r13 desc CDATA", "<svg><desc><![CDATA[><textarea>]]></desc></svg><style>/*keep*/</style></textarea>", "/*keep*/", "css"],
		["r13 foreignObject CDATA", "<svg><foreignObject><![CDATA[><textarea>]]></foreignObject></svg><style>/*keep*/</style></textarea>", "/*keep*/", "css"]
	];

	for (const [name, input, payload, language] of cases)
	{
		it(name, () =>
		{
			expectKept(input, payload, language);
		});
	}

	it("r14: pre/code holding svg title, desc, foreignObject or g", () =>
	{
		expectChangeable("//keep&#10;keep=1", "js");

		for (const block of ["pre", "code"])
		{
			for (const inner of ["title", "desc", "foreignObject", "g"])
			{
				const input = `<${block}><svg><${inner}></${block}></${inner}><script>//keep&#10;keep=1</script></svg>`;

				expect(html(input)).toBe(input);
			}
		}
	});
});

describe("HTML gate and latch beyond what main gets right", () =>
{
	it("the gate covers every context wrapper the r7 probes used", () =>
	{
		const payload = "//keep\nfoo()";

		expectChangeable(payload, "js");

		for (const [open, close] of [
			["<html><body><table><colgroup>", "</colgroup></table></body></html>"],
			["<html><body><select>", "</select></body></html>"],
			["<html><frameset>", "</frameset></html>"]
		])
		{
			expect(html(`${open}<script>${payload}</script>${close}`)).toBe(`${open}<script>${payload}</script>${close}`);
		}
	});

	it("r6 annotation-xml script with a comment", () =>
	{
		expectKept("<math><annotation-xml encoding=\"text/html\"><script>const s=\"&amp;\";\n// c\n</script></annotation-xml></math>", "const s=\"&amp;\";\n// c\n", "js");
	});

	it("a latched rest keeps whitespace and comments byte for byte", () =>
	{
		expect(html("<p>a</p>\n<svg><title><b>x</b>\n\n<!--c--></title></svg>")).toBe("<p>a</p><svg><title><b>x</b>\n\n<!--c--></title></svg>");
		expect(html("<p>a</p>\n<pre><svg><g></pre> a  b")).toBe("<p>a</p> <pre><svg><g></pre> a  b");
	});

	it("diff r1: in a gated document, raw text that hides a state-changing tag latches the rest (red on main)", () =>
	{
		// the parser can ignore the <style> (in select, in frameset), so its "<textarea>" or "<!--" may be real: the
		// scanner cannot know where that RCDATA or comment ends, so nothing from the style on is edited
		expect(html("<select><style><textarea></style>A  B<!--text--></textarea>")).toBe("<select><style><textarea></style>A  B<!--text--></textarea>");
		expect(html("<p>x  y</p><frameset><script><!--</script>A  B--><p>x</p>")).toBe("<p>x y</p><frameset><script><!--</script>A  B--><p>x</p>");

		// control: a gated document whose raw text hides nothing is still minified outside its payloads
		expect(html("<p>x  y</p>\n<select><option>a</option></select>\n<style>a { color: red }</style>\n<p>c  d</p>")).toBe("<p>x y</p><select><option>a</option></select><style>a { color: red }</style><p>c d</p>");

		// control: the same hidden tag in an ungated document is raw text the parser cannot skip
		expect(html("<p>x  y</p><style><textarea></style>A  B")).toBe(`<p>x y</p><style>${minify__("<textarea>", "css")}</style>A B`);
	});
});

describe("HTML foreign content", () =>
{
	it("main already does this right: an icon svg with a plain title is minified as before", () =>
	{
		expect(html("<svg viewBox=\"0 0 1 1\">\n  <title>Icon</title>\n  <path d=\"M0 0\"/>\n</svg>")).toBe("<svg viewBox=\"0 0 1 1\"><title>Icon</title><path d=\"M0 0\"/></svg>");
	});

	it("CDATA in svg is vaulted, a comment inside it is text", () =>
	{
		expect(html("<svg><text><![CDATA[a  <!--b-->  c]]></text></svg>")).toBe("<svg><text><![CDATA[a  <!--b-->  c]]></text></svg>");
		expect(html("<svg><![CDATA[a  b")).toBe("<svg><![CDATA[a  b");
		expect(html("<p><![CDATA[x]]></p>")).toBe("<p><![CDATA[x]]></p>");
	});

	it("svg style and script text is vaulted", () =>
	{
		expect(html("<svg><style>\na  { fill : red }\n</style></svg>")).toBe("<svg><style>\na  { fill : red }\n</style></svg>");
		expect(html("<svg><script>\n// c\nfoo();\n</script></svg>")).toBe("<svg><script>\n// c\nfoo();\n</script></svg>");
	});

	it("a breakout leaves foreign content, so the textarea after it is RCDATA", () =>
	{
		expect(html("<svg><p><textarea> a  <!--x--></textarea>")).toBe("<svg><p><textarea> a  <!--x--></textarea>");
		expect(html("<svg><font color=red><textarea> a </textarea>")).toBe("<svg><font color=red><textarea> a </textarea>");
	});

	it("main already does this right: font without color, face or size stays foreign", () =>
	{
		expect(html("<svg><font><textarea> a  b </textarea></font></svg>")).toBe("<svg><font><textarea> a b </textarea></font></svg>");
	});

	it("an end tag pops to its nearest open match", () =>
	{
		expect(html("<svg><g><a></g>\n<style>a { b }</style></svg>")).toBe("<svg><g><a></g><style>a { b }</style></svg>");
		expect(html("<svg><g/><style> a  b </style></svg>\n<style>a { color: red }</style>")).toBe(`<svg><g/><style> a  b </style></svg><style>${css("a { color: red }")}</style>`);
	});
});

describe("HTML U+0001 and many markers", () =>
{
	it("positive control: markers come back for a vaulted value and block", () =>
	{
		expect(html("<p title=\"a  b\">x  y</p><pre> z </pre>")).toBe("<p title=\"a  b\">x y</p><pre> z </pre>");
	});

	it("main already does this right: U+0001 in the input is never read as a marker", () =>
	{
		expect(html("x\u0001y<p a\u0001b='\u0001'>\u00010\u0001</p>")).toBe("x\u0001y<p a\u0001b='\u0001'>\u00010\u0001</p>");
		expect(html("<p title=\"a\">\u00010\u0001</p><pre> a </pre>")).toBe("<p title=\"a\">\u00010\u0001</p><pre> a </pre>");
		expect(html("<a href=\"\u0001\">\u00011\u0001</a>")).toBe("<a href=\u0001>\u00011\u0001</a>");
		expect(html("<\u0001>\u0001</\u0001>")).toBe("<\u0001>\u0001</\u0001>");
	});

	it("U+0001 next to the stream rules' trigger characters", () =>
	{
		expect(html("<p>a</p>\u0001\n<p>b</p>")).toBe("<p>a</p>\u0001 <p>b</p>");
		expect(html("<p>\u0001  \u0001</p>")).toBe("<p>\u0001 \u0001</p>");
		expect(html("<p \u0001 = \"\u0001\" >\u0001<!--\u0001-->\u0001</p >")).toBe("<p \u0001=\"\u0001\">\u0001\u0001</p>");
		expect(html("<pre>\u0001</pre>\u0001<code>\u00010\u0001</code>")).toBe("<pre>\u0001</pre>\u0001<code>\u00010\u0001</code>");
		expect(html("<script>\u0001//c\nx\u0001</script>")).toBe(`<script>${js("\u0001//c\nx\u0001")}</script>`);
		expect(html("<svg><script>\u0001 \u0001</script><![CDATA[\u0001]]></svg>")).toBe("<svg><script>\u0001 \u0001</script><![CDATA[\u0001]]></svg>");
		expect(html("\u0001")).toBe("\u0001");
	});

	it("thousands of markers restore in order", () =>
	{
		const unit = "<p a=\"1  2\" b='\u0001'>\u0001 $& </p>\n<pre> \u00010\u0001  </pre>\n";
		const expected = "<p a=\"1  2\" b='\u0001'>\u0001 $& </p> <pre> \u00010\u0001  </pre> ";

		expect(html(unit.repeat(5000))).toBe(expected.repeat(5000).trimEnd());
	});
});

describe("HTML guards pinned by the mutation pass", () =>
{
	// Each test fails when the guard it names is disabled, inverted or widened to main's behaviour; the rest of this
	// file left those mutants alive.

	it("an attribute name can start with \"=\" (red on main)", () =>
	{
		expect(html("<p = x >")).toBe("<p = x>");
	});

	it("a tag name runs to HTML whitespace only: \"<svg\\u00A0x>\" opens no foreign content (red on main)", () =>
	{
		// positive control: in foreign content a textarea is markup and its text collapses
		expect(html("<svg x><textarea> a  b </textarea>")).toBe("<svg x><textarea> a b </textarea>");
		expect(html("<svg\u00A0x><textarea> a  b </textarea>")).toBe("<svg\u00A0x><textarea> a  b </textarea>");
	});

	it("an unquoted value runs past NBSP and quotes, so a \"/\" at its end is no void slash (red on main)", () =>
	{
		// positive control: the void slash goes after whitespace
		expect(html("<img src=x />")).toBe("<img src=x>");
		expect(html("<img src=x\u00A0/>")).toBe("<img src=x\u00A0/>");
		expect(html("<img alt=a\"/>")).toBe("<img alt=a\"/>");
		expect(html("<img alt=a'/>")).toBe("<img alt=a'/>");
	});

	it("names are lowercased for A-Z only: a Kelvin sign is not \"k\" (red on main)", () =>
	{
		// positive control: an uppercase void name loses its "/"
		expect(html("<LINK/>")).toBe("<LINK>");
		expect(html("<LIN\u212A/>")).toBe("<LIN\u212A/>");
	});

	it("\"<\" + a non-ASCII letter is text (red on main)", () =>
	{
		// positive control: a tag loses the space before ">"
		expect(html("<e >")).toBe("<e>");
		expect(html("<\u00E9 >")).toBe("<\u00E9 >");
	});

	it("font with face or size breaks out of foreign content too (red on main)", () =>
	{
		expect(html("<svg><font face=x><textarea> a  b </textarea>")).toBe("<svg><font face=x><textarea> a  b </textarea>");
		expect(html("<svg><font size=1><textarea> a  b </textarea>")).toBe("<svg><font size=1><textarea> a  b </textarea>");
	});

	it("main already does this right: \"/>\" goes only on a void name not followed by a word character", () =>
	{
		expect(html("<img/>")).toBe("<img>");
		expect(html("<imgx/>")).toBe("<imgx/>");
	});

	it("main already does this right: href/src keep their quotes with whitespace around \"=\" or an empty value", () =>
	{
		expect(html("<a href=\"/x\">x</a>")).toBe("<a href=/x>x</a>");
		expect(html("<a href =\"/x\">x</a>")).toBe("<a href=\"/x\">x</a>");
		expect(html("<a href= \"/x\">x</a>")).toBe("<a href=\"/x\">x</a>");
		expect(html("<a href=\"\">x</a>")).toBe("<a href=\"\">x</a>");
	});

	it("main already does this right: U+0001 in a tag name is not read as a marker", () =>
	{
		expect(html("<p\u00010\u0001 >x</p>")).toBe("<p\u00010\u0001>x</p>");
	});

	it("main already does this right: a single tab in text becomes a space", () =>
	{
		expect(html("<p>a\tb</p>")).toBe("<p>a b</p>");
	});

	it("\"/\" after the end tag name ends RCDATA (red on main)", () =>
	{
		expect(html("<title>a  b</title/><p>c  d</p>")).toBe("<title>a  b</title/><p>c d</p>");
	});

	it("every JavaScript MIME type is minified (red on main)", () =>
	{
		expectChangeable("//c\nfoo()", "js");
		expect(html("<script type=\"application/javascript\">//c\nfoo()</script>")).toBe("<script type=\"application/javascript\">foo()</script>");
		expect(html("<script type=\"text/ecmascript\">//c\nfoo()</script>")).toBe("<script type=\"text/ecmascript\">foo()</script>");
		expect(html("<script type=\"application/ecmascript\">//c\nfoo()</script>")).toBe("<script type=\"application/ecmascript\">foo()</script>");
	});

	it("main already does this right: \"<!-->\" in a script returns to script data", () =>
	{
		expect(html("<script><!--><script></script>  x</script>")).toBe("<script><!--><script></script> x</script>");
	});

	it("\"-->\" in a script returns to script data, so a later <script> does not double-escape (red on main)", () =>
	{
		expect(html("<script><!-- --><script></script>  x</script>")).toBe("<script><!-- --><script></script> x</script>");
	});

	it("a style with two type attributes stays verbatim (red on main)", () =>
	{
		expectKept("<style type=\"text/css\" type=\"text/less\">a { b: c }</style>", "a { b: c }", "css");
	});

	it("a style type is ASCII case-insensitive (red on main)", () =>
	{
		expect(html("<style id=a type=\"TEXT/CSS\">a { b: c }</style>")).toBe("<style id=a type=\"TEXT/CSS\">a{b:c}</style>");
	});

	it("a script type is ASCII case-insensitive and trimmed of ASCII whitespace only (red on main)", () =>
	{
		expect(html("<script id=a type=\"TEXT/JAVASCRIPT\">//c\nfoo()</script>")).toBe("<script id=a type=\"TEXT/JAVASCRIPT\">foo()</script>");
		expect(html("<script type=\"MODULE\">//c\nfoo()</script>")).toBe("<script type=\"MODULE\">foo()</script>");
		expectKept("<script type=\"\u00A0text/javascript\">//c\nfoo()</script>", "//c\nfoo()", "js");
	});

	it("a script holding \"<!--\" only inside a comment stays verbatim (red on main)", () =>
	{
		expectKept("<script>// <!--\nfoo()</script>", "// <!--\nfoo()", "js");
	});

	it("the \"</script\" post-check is ASCII case-insensitive (red on main)", () =>
	{
		const payload = "const s=\"</SCRIPT\u00A0>\";\n// c\nfoo();";

		expectChangeable(payload, "js");
		expect(js(payload)).toContain("</SCRIPT");
		expect(html(`<script>${payload}</script>`)).toBe("<script>const s=\"</SCRIPT\u00A0>\";\n// c\nfoo();</script>");
	});

	it("<svg/> opens no foreign content (red on main)", () =>
	{
		// positive control: an open svg makes the textarea markup
		expect(html("<svg><textarea> a  b</textarea>")).toBe("<svg><textarea> a b</textarea>");
		expect(html("<svg/><textarea> a  b</textarea>")).toBe("<svg/><textarea> a  b</textarea>");
	});

	it("main already does this right: a self-closed svg title opens no integration point", () =>
	{
		expect(html("<svg><title/>\n<path d=\"M0 0\"/>\n</svg>")).toBe("<svg><title/><path d=\"M0 0\"/></svg>");
	});

	it("main already does this right: an end tag pops only to its nearest match", () =>
	{
		expect(html("<svg><g><g></g></g></svg><p>a  b</p>")).toBe("<svg><g><g></g></g></svg><p>a b</p>");
	});

	it("main already does this right: <pre> breaks out of svg and is a preserved block", () =>
	{
		expect(html("<svg><pre> a  b</pre></svg>")).toBe("<svg><pre> a  b</pre></svg>");
	});

	it("main already does this right: \"<![CDATA[\" in HTML content is a bogus comment", () =>
	{
		expect(html("<p><![CDATA[a  b]]></p>")).toBe("<p><![CDATA[a b]]></p>");
	});

	it("a start tag inside a MathML integration point latches (red on main)", () =>
	{
		expect(html("<p>a</p>\n<math><mi><b>x</b>\n\n<!--c--></mi></math>")).toBe("<p>a</p><math><mi><b>x</b>\n\n<!--c--></mi></math>");
		expect(html("<p>a</p>\n<math><mo><b>x</b>\n\n<!--c--></mo></math>")).toBe("<p>a</p><math><mo><b>x</b>\n\n<!--c--></mo></math>");
		expect(html("<p>a</p>\n<math><mn><b>x</b>\n\n<!--c--></mn></math>")).toBe("<p>a</p><math><mn><b>x</b>\n\n<!--c--></mn></math>");
		expect(html("<p>a</p>\n<math><ms><b>x</b>\n\n<!--c--></ms></math>")).toBe("<p>a</p><math><ms><b>x</b>\n\n<!--c--></ms></math>");
		expect(html("<p>a</p>\n<math><mtext><b>x</b>\n\n<!--c--></mtext></math>")).toBe("<p>a</p><math><mtext><b>x</b>\n\n<!--c--></mtext></math>");
		expect(html("<p>a</p>\n<math><annotation-xml><b>x</b>\n\n<!--c--></annotation-xml></math>")).toBe("<p>a</p><math><annotation-xml><b>x</b>\n\n<!--c--></annotation-xml></math>");
	});

	it("main already does this right: </br> and </p> leave foreign content, so the HTML after them is minified", () =>
	{
		expect(html("<svg></br>\n<p>a  b</p>")).toBe("<svg></br><p>a b</p>");
		expect(html("<svg></p>\n<p>a  b</p>")).toBe("<svg></p><p>a b</p>");
	});

	it("</p> inside an integration point latches (red on main)", () =>
	{
		expect(html("<svg><title></p></title></svg>\n<p>a  b</p>")).toBe("<svg><title></p></title></svg>\n<p>a  b</p>");
	});

	it("\"<!--->\" ends a comment, so the textarea after it is real (red on main)", () =>
	{
		expect(html("<!---><textarea> a  b</textarea>")).toBe("<!---><textarea> a  b</textarea>");
	});

	it("a comment ends at the first of \"--!>\" and \"-->\" (red on main)", () =>
	{
		expect(html("<!--a--!><textarea> -->  x</textarea>")).toBe("<!--a--!><textarea> -->  x</textarea>");
	});

	it("main already does this right: an unterminated comment runs to the end of the document", () =>
	{
		expect(html("<!--<textarea> a  b</textarea>")).toBe("<!--<textarea> a b</textarea>");
	});

	it("main already does this right: \"</\" + a non-letter starts a bogus comment", () =>
	{
		expectKept("</ <style>a { b }</style>", "a { b }", "css");
	});
});

describe("HTML diff review round 2", () =>
{
	it("diff r2: with <select>, <frameset> or <col> in it, an HTML raw text or RCDATA start tag in foreign content latches the rest (red on main)", () =>
	{
		// the parser ignores <svg>/<math> in select (and frameset, column group) modes, so the <textarea> is HTML RCDATA
		// whose value is "A  B<!--text-->"; the scanner cannot know that, so nothing from that tag on is edited
		const inputs = [
			"<select><svg><textarea>A  B<!--text--></textarea></svg>",
			"<select><math><textarea>A  B<!--text--></textarea></math>",
			"<select><svg><title>A  B<!--x--></title></svg><p>c  d</p>",
			"<SeLeCt><svg><g><textarea>A  B</textarea></g></svg>",
			"<frameset><svg><textarea>A  B</textarea></svg>",
			"<table><col><svg><textarea>A  B</textarea></svg></table>",
			...["script", "style", "xmp", "iframe", "noembed", "noframes", "noscript", "textarea", "title", "plaintext"].map(name => `<select><svg><${name}>A  B<!--c--></${name}></svg>`)
		];

		for (const input of inputs) expect(html(input), input).toBe(input);

		expect(html("<p>a  b</p>\n<select></select>\n<svg>\n<g>  </g>\n<title>t  u</title></svg>")).toBe("<p>a b</p><select></select><svg><g></g> <title>t  u</title></svg>");
	});

	it("diff r2: with <select> in it, a CDATA section in foreign content latches the rest (red on main)", () =>
	{
		// in select mode "<![CDATA[x>" is a bogus comment, and the <textarea> after it is real
		expect(html("<select><svg><![CDATA[x><textarea>]]>A  B</textarea></svg>")).toBe("<select><svg><![CDATA[x><textarea>]]>A  B</textarea></svg>");
		expect(html("<p>a  b</p><select></select><svg>  <![CDATA[x]]>  <g>  </g>  </svg>")).toBe("<p>a b</p><select></select><svg> <![CDATA[x]]>  <g>  </g>  </svg>");
	});

	it("main already does this right: without <select>, <frameset> or <col>, foreign content is minified, also when <noscript> gates the payloads", () =>
	{
		// the <p> after the svg shows the scan did not latch (svg title text itself stays as written since diff r2)
		expect(html("<p>a  b</p><svg>  <title>t</title>  </svg><p>c  d</p>")).toBe("<p>a b</p><svg><title>t</title></svg><p>c d</p>");
		expect(html("<noscript></noscript><p>a  b</p><svg>  <title>t</title>  </svg><p>c  d</p>")).toBe("<noscript></noscript><p>a b</p><svg><title>t</title></svg><p>c d</p>");
		expect(html("<noscript></noscript><svg><![CDATA[x]]><g>  </g>  </svg><p>c  d</p>")).toBe("<noscript></noscript><svg><![CDATA[x]]><g></g></svg><p>c d</p>");
	});

	it("diff r2: character data inside svg text, tspan and textPath stays as written, whitespace-only runs included (red on main)", () =>
	{
		const inputs = [
			"<svg xml:space=\"preserve\"><text>A  B</text></svg>",
			"<svg><text><tspan>a</tspan> <tspan>b</tspan></text></svg>",
			"<svg><text>\n  a  <tspan>b</tspan>\n</text></svg>",
			"<svg><tspan>a  b</tspan></svg>",
			"<svg><textPath startOffset=\"1\">a  b</textPath></svg>",
			"<svg><TEXT><tspan xml:space=\"default\">c  d</tspan>  e</TEXT></svg>",
			"<svg><text><a xml:space=\"default\">c  d</a></text></svg>"
		];

		for (const input of inputs) expect(html(input), input).toBe(input);

		// the scope ends with its element, and a breakout leaves it
		expect(html("<svg>\n  <text>a  b</text>\n  <g>  x  y</g>\n</svg>")).toBe("<svg><text>a  b</text><g> x y</g></svg>");
		expect(html("<svg xml:space=\"preserve\"><text>a  b</text><p>c  d</p><svg><g>  x  y</g></svg>")).toBe("<svg xml:space=\"preserve\"><text>a  b</text><p>c d</p><svg><g> x y</g></svg>");
	});

	it("diff r2: svg title and desc text stays as written, as the SVG minifier keeps it (red on main)", () =>
	{
		expect(html("<svg><title>A  B</title><desc>C\n  D</desc></svg>")).toBe("<svg><title>A  B</title><desc>C\n  D</desc></svg>");

		// control: whitespace between the other elements still collapses
		expect(html("<svg>\n  <title>A  B</title>\n  <g>  x  y</g>\n</svg>")).toBe("<svg><title>A  B</title><g> x y</g></svg>");
	});

	it("diff r2: an xml:space scope keeps character data; it is inherited, and only exactly \"default\" resets it (red on main)", () =>
	{
		const inputs = [
			"<svg xml:space=\"preserve\"><g>  x  y  <path/>  </g></svg>",
			"<svg xml:space=\"&#100;efault\"><g>  x  y</g></svg>",
			"<svg xml:space=\"Default\"><g>  x  y</g></svg>",
			"<svg xml:space><g>  x  y</g></svg>",
			"<svg XML:SPACE=preserve><g>  x  y</g></svg>",
			"<svg xml:space=\"preserve\" xml:space=\"default\"><g>  x  y</g></svg>"
		];

		for (const input of inputs) expect(html(input), input).toBe(input);

		expect(html("<svg xml:space=\"preserve\"><g xml:space=\"default\">  <path/>  x  y</g>  z  </svg>")).toBe("<svg xml:space=\"preserve\"><g xml:space=\"default\"><path/> x y</g>  z  </svg>");
		expect(html("<svg xml:space=\"default\" xml:space=\"preserve\"><g>  x  y</g></svg>")).toBe("<svg xml:space=\"default\" xml:space=\"preserve\"><g> x y</g></svg>");
	});

	it("main already does this right: indentation between other svg elements still collapses", () =>
	{
		expect(html("<svg>\n  <g>\n    <path d=\"M0 0\"/>\n  </g>\n</svg>")).toBe("<svg><g><path d=\"M0 0\"/></g></svg>");
		expect(html("<svg xml:space=\"default\">\n  <g>  x  y</g>\n</svg>")).toBe("<svg xml:space=\"default\"><g> x y</g></svg>");
	});

	it("diff r2: a DOCTYPE is kept as written (red on main)", () =>
	{
		// removing the second space before "Transitional" turns no-quirks mode into quirks mode
		const witness = "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01  Transitional//EN\"><html><body><p>A</p></body></html>";

		expect(html(witness)).toBe(witness);
		expect(html("<!DOCTYPE  html>\n<html>\n  <body>\n</body></html>")).toBe("<!DOCTYPE  html><html><body></body></html>");
		expect(html("<!doctype\thtml  SYSTEM 'a  b'>\n<p>x</p>")).toBe("<!doctype\thtml  SYSTEM 'a  b'><p>x</p>");
		expect(html("<p>x</p>\n<!DOCTYPE html  a")).toBe("<p>x</p> <!DOCTYPE html  a");
	});

	it("main already does this right: a plain DOCTYPE, and bogus comments still go through the stream rules", () =>
	{
		expect(html("<!DOCTYPE html>\n<html>\n<p>x</p>")).toBe("<!DOCTYPE html><html><p>x</p>");
		expect(html("<p>x</p><?doctype  a>")).toBe("<p>x</p><?doctype a>");
		expect(html("<!doctyp  a>")).toBe("<!doctyp a>");
	});

	it("main already does this right: the fuzz witness, a comment holding \"\\u00012\\u0001\" before a pre", () =>
	{
		expect(html("<!--\u00012\u0001--><pre>text</pre>")).toBe("<pre>text</pre>");
	});
});

describe("HTML diff review round 9", () =>
{
	it("diff r9: a comment right after CR stays, since dropping it would join that CR and a LF after it into one line break (red on main)", () =>
	{
		// parse5 reads "a\r<!-- x -->\nb" in a preserved SVG text as "a\n\nb" and "a\r\nb" as "a\nb"
		const witness = "<svg xml:space=\"preserve\"><text>a\r<!-- text -->\nb</text></svg>";

		expect(html(witness)).toBe(witness);
		expect(html("<svg xml:space=\"preserve\"><text>a\r<!--a--><!--b-->\nb</text></svg>")).toBe("<svg xml:space=\"preserve\"><text>a\r<!--a-->\nb</text></svg>");

		// controls: after LF, and in text that collapses, a comment still goes
		expect(html("<svg xml:space=\"preserve\"><text>a\n<!-- text -->\nb</text></svg>")).toBe("<svg xml:space=\"preserve\"><text>a\n\nb</text></svg>");
		expect(html("<p>a\n<!-- x -->\nb</p>")).toBe("<p>a  b</p>");
	});

	it("diff r9: an element that stops the scope search for the end tag leaves the rest as written (red on main)", () =>
	{
		// the parser ignores a </pre> (or </code>, </listing>) while a table, select, template, object, applet, marquee or an
		// SVG or MathML integration point is open inside it: the text after the real end tag is still in the block (the
		// SVG and MathML rows were already kept as written by the foreign-content latch: red on main only)
		const kept = [
			"<pre><table></pre></table>a  b</pre>",
			"<pre><select></pre></select>a  b</pre>",
			"<pre><template></pre></template>a  b</pre>",
			"<pre><object></pre></object>a  b</pre>",
			"<pre><applet></pre></applet>a  b</pre>",
			"<pre><marquee></pre></marquee>a  b</pre>",
			"<pre><svg><title></pre></title></svg>a  b</pre>",
			"<pre><math><mi></pre></mi></math>a  b</pre>",
			"<code><table></code></table>a  b</code>",
			"<listing><table></listing></table>a  b</listing>"
		];

		for (const input of kept) expect(html(input)).toBe(input);

		// every SVG and MathML integration point, in each block: the foreign-content latch already keeps these
		for (const block of ["pre", "code", "listing"])
		{
			for (const name of ["foreignObject", "desc", "title"]) expect(html(`<${block}><svg><${name}></${block}></${name}></svg>a  b</${block}>`)).toBe(`<${block}><svg><${name}></${block}></${name}></svg>a  b</${block}>`);
			for (const name of ["mi", "mo", "mn", "ms", "mtext", "annotation-xml"]) expect(html(`<${block}><math><${name}></${block}></${name}></math>a  b</${block}>`)).toBe(`<${block}><math><${name}></${block}></${name}></math>a  b</${block}>`);
		}

		// what comes before the block is minified as usual, what comes after it is not
		expect(html("<p>x  y</p>\n<pre><table></pre></table>a  b</pre>\n<p>c  d</p>")).toBe("<p>x y</p> <pre><table></pre></table>a  b</pre>\n<p>c  d</p>");

		// controls: a pre without one still ends at its first end tag, with the text after it collapsing
		expect(html("<pre><b>x</b></pre>  <p>a  b</p>")).toBe("<pre><b>x</b></pre> <p>a b</p>");
		expect(html("<pre><svg><g></g></svg></pre>\n<p>a  b</p>")).toBe("<pre><svg><g></g></svg></pre> <p>a b</p>");
	});

	it("diff r9: a document that mentions white-space keeps its text whitespace, apart from runs between tags (red on main)", () =>
	{
		// a style attribute, a stylesheet in the document or a class name can make any element keep its spaces and lines
		expect(html("<div style=\"white-space:pre\">a  b</div>")).toBe("<div style=\"white-space:pre\">a  b</div>");
		expect(html("<style>.text{white-space:pre}</style><div class=\"text\">a  b</div>\n<p> c   d </p>\n")).toBe("<style>.text{white-space:pre}</style><div class=\"text\">a  b</div><p> c   d </p>\n");
		expect(html("<div class=\"whitespace-pre-line\"> a\n b </div> <i>x</i>")).toBe("<div class=\"whitespace-pre-line\"> a\n b </div><i>x</i>");
		expect(html("<div style=\"WHITE\\2d SPACE:pre\">a\r\n\tb</div>")).toBe("<div style=\"WHITE\\2d SPACE:pre\">a\r\n\tb</div>");

		// controls: no mention, no change; tags still lose the spaces inside them
		expect(html("<p>a  b</p>\n<p>c\n\td</p>\n")).toBe("<p>a b</p><p>c d</p>");
		expect(html("<div  style=\"white-space:pre\"  >a  b</div>")).toBe("<div style=\"white-space:pre\">a  b</div>");
	});
});

describe("HTML diff review round 10", () =>
{
	it("diff r10: a style attribute that spells white-space with a character reference or an escape keeps the document's text whitespace (red on main)", () =>
	{
		// "&#x0002d;" is "-" and "\65" is "e": neither is the text "white-space", and each can name the property
		const kept = [
			"<div style=\"white&#x0002d;space:pre\">a  b</div>",
			"<div style=\"WHITE-SPACE:pre\">a  b</div>",
			"<div style=\"whit\\65-space:pre\">a  b</div>",
			"<div style=\"white\\2d\nspace:pre\">a  b</div>",
			"<div style='whit\\65-space:pre'>a  b</div>",
			"<div style=whit\\65-space:pre>a  b</div>",
			"<div STYLE=\"whit\\65-space:pre\">a  b</div>",
			"<p>a  b</p><div style=\"w\\68ite-space:pre\">c  d</div>"
		];

		for (const input of kept) expect(html(input)).toBe(input);

		// controls: a style attribute with neither, a reference or a backslash in another attribute, a backslash outside style
		expect(html("<div style=\"color:red\">a  b</div>")).toBe("<div style=\"color:red\">a b</div>");
		expect(html("<div style title=\"a&amp;b\">a  b</div>")).toBe("<div style title=\"a&amp;b\">a b</div>");
		expect(html("<a title=\"a&amp;b\" data-a=\"x\\y z\">a  b</a>")).toBe("<a title=\"a&amp;b\" data-a=\"x\\y z\">a b</a>");
		expect(html("<p>a\\b  c &amp; d</p>")).toBe("<p>a\\b c &amp; d</p>");
	});

	it("diff r10: a style element that holds a backslash keeps the document's text whitespace, in HTML and in foreign content (red on main)", () =>
	{
		const kept = [
			"<style>.a{whit\\65-space:pre}</style><div class=\"a\">x  y</div>",
			"<STYLE>.a{whit\\65-space:pre}</STYLE><div class=\"a\">x  y</div>",
			"<div class=\"a\">x  y</div><style>.a{whit\\65-space:pre}</style>",
			"<svg><style>.a{whit\\65-space:pre}</style></svg><div class=\"a\">x  y</div>",
			"<svg><style>.a{white&#45;space:pre}</style></svg><div class=\"a\">x  y</div>",
			"<math><style>.a{white&#45;space:pre}</style></math><div class=\"a\">x  y</div>",
			"<svg><style><![CDATA[/* </style> */.a{whit\\65-space:pre}]]></style></svg><div class=\"a\">x  y</div>",
			"<style>.b{x:y}</style><style>.a{whit\\65-space:pre}</style><div class=\"a\">x  y</div>",
			"<style>.a{x:y}</styles><style>.a{whit\\65-space:pre}</style><div>x  y</div>",
			"<style>.a{x:y}</styles>.a{whit\\65-space:pre}</style><div>x  y</div>",
			"<div class=\"a\">x  y</div><style>.a{whit\\65-space:pre}",
			"<style title=\"</style >\">.a{whit\\65-space:pre}</style><div>x  y</div>"
		];

		for (const input of kept) expect(html(input)).toBe(input);

		// a comment in a foreign style element holds an end tag that is not one; the comment goes, the whitespace stays
		expect(html("<svg><style><!-- </style> -->.a{whit\\65-space:pre}</style></svg><div class=\"a\">x  y</div>")).toBe("<svg><style>.a{whit\\65-space:pre}</style></svg><div class=\"a\">x  y</div>");

		expect(html("<style >.a{whit\\65-space:pre}</style><div class=\"a\">x  y</div>")).toBe("<style>.a{whit\\65-space:pre}</style><div class=\"a\">x  y</div>");

		// controls: no backslash, or only after the element's end tag, is as before
		expect(html("<style>.a{color:red}</style><div>x  y</div>")).toBe("<style>.a{color:red}</style><div>x y</div>");
		expect(html("<style>.a{color:red}</style><div>x  y\\z</div>")).toBe("<style>.a{color:red}</style><div>x y\\z</div>");
		expect(html("<style>.a{color:red}</style>\\<style>.b{color:red}</style><div>x  y</div>")).toBe("<style>.a{color:red}</style>\\<style>.b{color:red}</style><div>x y</div>");
		expect(html("<svg><style>.a{color:red}</style></svg><div>x  y</div>")).toBe("<svg><style>.a{color:red}</style></svg><div>x y</div>");
		expect(html("<svg><style>.a{color:red}</style></svg><div>x  y\\z</div>")).toBe("<svg><style>.a{color:red}</style></svg><div>x y\\z</div>");
		expect(html("<svg><style title=\"a&amp;b\">.a{color:red}</style></svg><div>x  y</div>")).toBe("<svg><style title=\"a&amp;b\">.a{color:red}</style></svg><div>x y</div>");
		expect(html("<div>x  y\\z &amp;</div><svg><style>.a{color:red}</style></svg>")).toBe("<div>x y\\z &amp;</div><svg><style>.a{color:red}</style></svg>");
		expect(html("<style>.a::before{content:\"&amp;\"}</style><div>x  y</div>")).toBe("<style>.a::before{content:\"&amp;\"}</style><div>x y</div>");
		expect(html("<style>.a{color:red}</style/><div>x  y\\z</div>")).toBe("<style>.a{color:red}</style/><div>x y\\z</div>");
		expect(html("<style>.a{color:red}</style\n><div>x  y\\z</div>")).toBe("<style>.a{color:red}</style><div>x y\\z</div>");
		expect(html("<STYLE>.a{color:red}</STYLE><div>x  y\\z</div>")).toBe("<STYLE>.a{color:red}</STYLE><div>x y\\z</div>");
		expect(html("<style data-x=\"a\\b\">.a{color:red}</style><div>x  y</div>")).toBe("<style data-x=\"a\\b\">.a{color:red}</style><div>x y</div>");
	});

	it("diff r12: a foreign style element whose text is split by markup keeps the document's text whitespace, and one of plain text does not (red on main)", () =>
	{
		// the stylesheet text is its text nodes joined: a CDATA section, a comment or a child element can sit inside a name
		const kept = [
			"<svg><style>.a{white<![CDATA[-]]>space:pre}</style></svg><div class=\"a\">x  y</div>",
			"<math><style>.a{white<![CDATA[-]]>space:pre}</style></math><div class=\"a\">x  y</div>",
			"<svg><style>.a{white<g></g>-space:pre}</style></svg><div class=\"a\">x  y</div>",
			"<svg><style><![CDATA[.a{color:red}]]></style></svg><div>x  y</div>",
			"<svg><style>.a{color:red}<![CDATA[ </style> ]]></style></svg><div>x  y</div>",
			"<div>x  y</div><svg><style>.a{color:red}"
		];

		for (const input of kept) expect(html(input)).toBe(input);

		// the comment goes (the comment loop's), and the document's whitespace stays
		expect(html("<svg><style>.a{white<!-- -->-space:pre}</style></svg><div class=\"a\">x  y</div>")).toBe("<svg><style>.a{white-space:pre}</style></svg><div class=\"a\">x  y</div>");

		// a text node alone has nothing to join: as before, in foreign content and in HTML (where CDATA is plain raw text)
		expect(html("<svg><style>.a{color:red}</style></svg><div>x  y</div>")).toBe("<svg><style>.a{color:red}</style></svg><div>x y</div>");
		expect(html("<style>.a{color:red}<![CDATA[x]]></style><div>x  y</div>")).toBe("<style>.a{color:red}<![CDATA[x]]></style><div>x y</div>");
	});

	it("diff r12: text after the scan stopped that holds a style element and an svg or math element keeps the document's text whitespace (red on main)", () =>
	{
		const stop = "<pre><table></pre></table>";
		const kept = [
			`<p class="a">x  y</p>${stop}<svg><style>.a{white<![CDATA[-]]>space:pre}</style></svg>`,
			`<p class="a">x  y</p>${stop}<math><style>.a{color:red}</style></math>`,
			`<p class="a">x  y</p>${stop}<style>.a{color:red}</style><SVG></SVG>`,
			`<p class="a">x  y</p>${stop}<style>.a{color:red}</style><svg/>`
		];

		for (const input of kept) expect(html(input)).toBe(input);

		// controls: a style element with neither, or an svg without one
		expect(html(`<p class="a">x  y</p>${stop}<style>.a{color:red}</style><p>a &amp; b</p>`)).toBe(`<p class="a">x y</p>${stop}<style>.a{color:red}</style><p>a &amp; b</p>`);
		expect(html(`<p class="a">x  y</p>${stop}<svg><g></g></svg>`)).toBe(`<p class="a">x y</p>${stop}<svg><g></g></svg>`);
	});

	it("diff r13: text after the scan stopped inside svg or math content that holds a style element keeps the document's text whitespace (red on 43335ba)", () =>
	{
		// the rest is still foreign content, where a reference or a CDATA section can spell the name: the svg was opened before the latch
		const stop = "<pre><table></pre></table>";
		const kept = [
			"<p class=\"a\">x  y</p><svg></unknown><style>.a{white&#45;space:pre}</style></svg>",
			"<p class=\"a\">x  y</p><svg></unknown><style>.a{white<![CDATA[-]]>space:pre}</style></svg>",
			"<p class=\"a\">x  y</p><math></unknown><style>.a{white<![CDATA[-]]>space:pre}</style></math>",
			"<p class=\"a\">x  y</p><svg><desc></x></desc><style>.a{white&#45;space:pre}</style></svg>",

			// a style element that is open at the latch: its text goes on in the rest, split by the unmatched end tag
			"<p class=\"a\">x  y</p><svg><style>.a{white</unknown>-space:pre}</style></svg>",
			"<p class=\"a\">x  y</p><math><style>.a{white</unknown>-space:pre}</style></math>",

			// conservative: any style element after a latch inside foreign content
			"<p class=\"a\">x  y</p><svg></unknown></svg><style>.a{color:red}</style>"
		];

		for (const input of kept) expect(html(input)).toBe(input);

		// controls: no style element in the rest, the foreign content closed before the latch, an HTML breakout that left it, a latch in HTML content
		expect(html("<p class=\"a\">x  y</p><svg></unknown><g></g></svg>")).toBe("<p class=\"a\">x y</p><svg></unknown><g></g></svg>");
		expect(html(`<p class="a">x  y</p><svg></svg>${stop}<style>.a{color:red}</style>`)).toBe(`<p class="a">x y</p><svg></svg>${stop}<style>.a{color:red}</style>`);
		expect(html("<p class=\"a\">x  y</p><svg><p></p><style>.a{white&#45;space:pre}</style></svg>")).toBe("<p class=\"a\">x y</p><svg><p></p><style>.a{white&#45;space:pre}</style></svg>");
		expect(html(`<p class="a">x  y</p>${stop}<style>.a{color:red}</style>`)).toBe(`<p class="a">x y</p>${stop}<style>.a{color:red}</style>`);
	});

	it("diff r13: raw text content that a select, frameset or col lets the parser ignore the start tag of is read as markup, so a style in it keeps the document's text whitespace (red on 43335ba)", () =>
	{
		const kept = [
			"<p class=\"a\">x  y</p><select><title><select><div style=\"white&#x2d;spac&#101;:pre\">",
			"<p class=\"a\">x  y</p><select><pre><xmp></select><div style=\"whit\\65 \\2d spac\\65:pre\"></template>",
			"<p class=\"a\">x  y</p><select><plaintext><template><div style=\"wh\\69te&#45;Space:pre}\"></noscript>",
			"<p class=\"a\">x  y</p><frameset><xmp><div style=\"white&#45;space:pre\">",

			// already kept: a style element in the content latches the rest
			"<p class=\"a\">x  y</p><select><xmp></select><style>.a{whit\\65-space:pre}</style>"
		];

		for (const input of kept) expect(html(input)).toBe(input);

		// controls: nothing in the content that can spell it; no select, frameset or col, where the start tag is not ignored
		expect(html("<p class=\"a\">x  y</p><select><xmp>plain</xmp></select>")).toBe("<p class=\"a\">x y</p><select><xmp>plain</xmp></select>");
		expect(html("<p class=\"a\">x  y</p><select><xmp></xmp><div style=\"color:red\"></select>")).toBe("<p class=\"a\">x y</p><select><xmp></xmp><div style=\"color:red\"></select>");
		expect(html("<p class=\"a\">x  y</p><select><xmp>x</xmp><div style=\"color:red\">a &amp; b</div>")).toBe("<p class=\"a\">x y</p><select><xmp>x</xmp><div style=\"color:red\">a &amp; b</div>");
		expect(html("<p class=\"a\">x  y</p><select><xmp style=\"color:red\" title=\"a&amp;b\">x</xmp>")).toBe("<p class=\"a\">x y</p><select><xmp style=\"color:red\" title=\"a&amp;b\">x</xmp>");
		expect(html("<p class=\"a\">x  y</p><select><plaintext style=\"color:red\" title=\"a&amp;b\">x")).toBe("<p class=\"a\">x y</p><select><plaintext style=\"color:red\" title=\"a&amp;b\">x");
		expect(html("<p class=\"a\">x  y</p><noscript><div style=\"white&#45;space:pre\"></noscript>")).toBe("<p class=\"a\">x y</p><noscript><div style=\"white&#45;space:pre\"></noscript>");
		expect(html("<p class=\"a\">x  y</p><xmp><div style=\"white&#45;space:pre\"></xmp>")).toBe("<p class=\"a\">x y</p><xmp><div style=\"white&#45;space:pre\"></xmp>");
		expect(html("<p class=\"a\">x  y</p><textarea><div style=\"white&#45;space:pre\"></textarea>")).toBe("<p class=\"a\">x y</p><textarea><div style=\"white&#45;space:pre\"></textarea>");
	});

	it("diff r15: whitespace next to a literal > or < in text stays (collapsed to one space unless the document spells white-space), and only a run alone between two tags is dropped (red on 4b106ba)", () =>
	{
		// the document spells white-space: the text as written, a literal ">" and "<" are text, not tag boundaries
		const kept = [
			"<p style=\"white-space:pre\">a >  < b</p>",
			"<p style=\"white-space:pre\">value >  <span>text</span></p>",
			"<p style=\"white-space:pre\"><b>x</b>  < y</p>"
		];

		expect(html(kept[0])).toBe(kept[0]);
		expect(html(kept[1])).toBe(kept[1]);
		expect(html(kept[2])).toBe(kept[2]);

		// a comment goes (the comment loop's) and the whitespace around it stays
		expect(html("<p style=\"white-space:pre\">a >\t\t<!-- c -->b</p><p>c</p>")).toBe("<p style=\"white-space:pre\">a >\t\tb</p><p>c</p>");

		// every document: one space, as for any other text (main removed it, so "Home > <a>" lost the space)
		expect(html("<p>a >  < b</p>")).toBe("<p>a > < b</p>");
		expect(html("<p>Home > <a href=\"/\">x</a></p>")).toBe("<p>Home > <a href=/>x</a></p>");
		expect(html("<b>x</b>  < y")).toBe("<b>x</b> < y");
		expect(html("<p>a >\n</p>")).toBe("<p>a > </p>");

		// controls: text of its own between two tags is not a gap; a run of whitespace alone between two tags or a tag and a comment is dropped, in either mode; one at the start or the end of the document is not between two tags
		expect(html("<p><b>x</b>a><i>y</i></p>")).toBe("<p><b>x</b>a><i>y</i></p>");
		expect(html("<p style=\"white-space:pre\"><b>x</b> a> <i>y</i></p>")).toBe("<p style=\"white-space:pre\"><b>x</b> a> <i>y</i></p>");
		expect(html("<b>x</b> <code>y</code> <b>z</b>")).toBe("<b>x</b> <code>y</code> <b>z</b>");
		expect(html("  <p style=\"white-space:pre\">a</p>  ")).toBe("  <p style=\"white-space:pre\">a</p>  ");
		expect(html("  <p>a</p>  ")).toBe("<p>a</p>");
		expect(html("<div> <p>a</p> <!-- c --> <p>b</p> </div>")).toBe("<div><p>a</p><p>b</p></div>");
		expect(html("<p style=\"white-space:pre\">a</p>  <p>b</p>")).toBe("<p style=\"white-space:pre\">a</p><p>b</p>");
		expect(html("<p style=\"white-space:pre\">a</p>\n\t<!-- c -->  <p>b</p>")).toBe("<p style=\"white-space:pre\">a</p><p>b</p>");
		expect(html("<ul> <li>a</li> \n <li>b</li> </ul>")).toBe("<ul><li>a</li><li>b</li></ul>");
	});

	it("diff r16: whitespace alone next to a comment, a bogus comment or a DOCTYPE is text of the node that goes on after it, and stays (red on 2978f97)", () =>
	{
		// the whitespace and the "a" are one text node once the comment is gone (Codex witnesses; the DOCTYPE inside a body is ignored)
		expect(html("<p style=\"white-space:pre\">  <?text>a</p>")).toBe("<p style=\"white-space:pre\">  <?text>a</p>");
		expect(html("<p style=\"white-space:pre\">  <!-- text -->a</p>")).toBe("<p style=\"white-space:pre\">  a</p>");
		expect(html("<p style=\"white-space:pre\">  <!doctype x>a</p>")).toBe("<p style=\"white-space:pre\">  <!doctype x>a</p>");
		expect(html("<p style=\"white-space:pre\"><b>x</b>\t<!-- c --><!-- d -->a</p>")).toBe("<p style=\"white-space:pre\"><b>x</b>\ta</p>");

		// any document: a space stays where text follows the comment (main dropped it, so "x a" became "xa")
		expect(html("<p><b>x</b>  <!-- c -->a</p>")).toBe("<p><b>x</b> a</p>");
		expect(html("<p><b>x</b>  <?c>a</p>")).toBe("<p><b>x</b> <?c>a</p>");
		expect(html("<p>a  <!-- c -->  <b>x</b></p>")).toBe("<p>a  <b>x</b></p>");

		// a run of whitespace and comments between two tags goes whole, in either mode
		expect(html("<p style=\"white-space:pre\"><b>x</b>  <!-- c -->  <i>y</i></p>")).toBe("<p style=\"white-space:pre\"><b>x</b><i>y</i></p>");
		expect(html("<p style=\"white-space:pre\"><b>x</b>  <?c>  <i>y</i></p>")).toBe("<p style=\"white-space:pre\"><b>x</b><?c><i>y</i></p>");
		expect(html("<div>\n<p>a</p>\n<!-- c -->\n<!-- d -->\n<p>b</p>\n</div>")).toBe("<div><p>a</p><p>b</p></div>");
		expect(html("<div>\n<p>a</p>\n<?c>\n<!-- d -->\n<p>b</p>\n</div>")).toBe("<div><p>a</p><?c><p>b</p></div>");

		// the DOCTYPE of a document is a tag; one after content is ignored by the parser and is not
		expect(html("<!DOCTYPE html>\n<html>\n<p>x</p>")).toBe("<!DOCTYPE html><html><p>x</p>");
		expect(html("<!-- banner -->\n<!DOCTYPE html>\n<html>\n<p>x</p>")).toBe("<!DOCTYPE html><html><p>x</p>");
		expect(html("<!-- banner -->\n<!DOCTYPE html>\n<html style=\"white-space:pre\">\n<p>x</p>")).toBe("\n<!DOCTYPE html><html style=\"white-space:pre\"><p>x</p>");
		expect(html("<p>x</p>\n<!DOCTYPE html>\n<p>y</p>")).toBe("<p>x</p> <!DOCTYPE html> <p>y</p>");
		expect(html("x\n<!DOCTYPE html>\n<p>y</p>")).toBe("x <!DOCTYPE html> <p>y</p>");

		// a comment kept after a CR or a high surrogate is a comment like any other: whitespace on both sides of it between two tags goes
		expect(html("<b>x</b>\r<!-- c -->\n<i>y</i>")).toBe("<b>x</b><!-- c --><i>y</i>");
		expect(html("<b>x</b>\r<!-- c -->y")).toBe("<b>x</b>\r<!-- c -->y");

		// at the start of the document, after a leading comment, the whitespace is not between two tags either
		expect(html("<?doctype  a>\n<p>x</p>")).toBe("<?doctype a> <p>x</p>");
		expect(html("<!-- c -->\n<p>x</p>")).toBe("<p>x</p>");
	});

	it("diff r12: a comment right after a high surrogate stays, since removing it would join the halves of a pair (red on main)", () =>
	{
		// two lone halves are two replacement characters once encoded; joined they are one character
		const witness = "<svg><text>a\uD83D<!-- text -->\uDE00b</text></svg>";

		expect(html(witness)).toBe(witness);
		expect(html("<p>a\uD83D<!-- x -->\uDE00b</p>")).toBe("<p>a\uD83D<!-- x -->\uDE00b</p>");
		expect(html("<p>a\uD83D<!--a--><!--b-->\uDE00b</p>")).toBe("<p>a\uD83D<!--a-->\uDE00b</p>");

		// controls: after a whole pair, after a low surrogate, after a character below and above the range
		expect(html("<p>\uD83D\uDE00<!-- x -->b</p>")).toBe("<p>\uD83D\uDE00b</p>");
		expect(html("<p>a\uDE00<!-- x -->b</p>")).toBe("<p>a\uDE00b</p>");
		expect(html("<p>a\uD7FF<!-- x -->\uDE00b</p>")).toBe("<p>a\uD7FF\uDE00b</p>");
		expect(html("<p>a\uE000<!-- x -->\uDE00b</p>")).toBe("<p>a\uE000\uDE00b</p>");
		expect(html("<!-- x --><p>a</p>")).toBe("<p>a</p>");
	});

	it("diff r10: text after the scan stopped is not read, so a style in it that could spell white-space keeps the document's whitespace (red on main)", () =>
	{
		// the parser's state after "</pre>" is not known here: the rest of the document is kept as written, styles included
		const stop = "<pre><table></pre></table>";
		const kept = [
			`<p>a  b</p>${stop}<style>.a{whit\\65-space:pre}</style>`,
			`<p>a  b</p>${stop}<div style="whit\\65-space:pre">c  d</div>`,
			`<p>a  b</p>${stop}<div style="white&#x2d;space:pre">c  d</div>`,
			"<p>a  b</p><pre><svg><title></pre></title></svg><STYLE>.a{whit\\65-space:pre}</STYLE>",
			"<p>a  b</p><div style=\"whit\\65-space:pre\" <p>c  d</p>",
			`<p>a  b</p>${stop}<div STYLE="whit\\65-space:pre">c  d</div>`,
			`<p>a  b</p>${stop}<svg><style>.a{white&#45;space:pre}</style></svg>`,
			`<p>a  b</p>${stop}<div style\t="whit\\65-space:pre">c  d</div>`,
			`<p>a  b</p>${stop}<style media="all">.a{whit\\65-space:pre}</style>`,
			`<p>a  b</p>${stop}<p>c  d</p><style>.a{color:red}</style>\\`
		];

		for (const input of kept) expect(html(input)).toBe(input);

		// controls: a rest with no style that holds a backslash or a "&", or a style with neither, is as before
		expect(html(`<p>a  b</p>${stop}<style>.a{color:red}</style>`)).toBe(`<p>a b</p>${stop}<style>.a{color:red}</style>`);
		expect(html(`<p>a  b</p>${stop}<style>.a::before{content:"&amp;"}</style>`)).toBe(`<p>a b</p>${stop}<style>.a::before{content:"&amp;"}</style>`);
		expect(html(`<p>a  b</p>${stop}<div style="color:red">c  d</div>`)).toBe(`<p>a b</p>${stop}<div style="color:red">c  d</div>`);
		expect(html(`<p>a  b</p>${stop}<p>c\\d &amp; e</p>`)).toBe(`<p>a b</p>${stop}<p>c\\d &amp; e</p>`);
	});
});

describe("HTML stays linear (each input over 500k characters, with one above U+00FF)", { timeout: TIMEOUT_MS__ }, () =>
{
	// [name, input, expected]
	const workloads = [
		["ported from MarkupScanners: pre/code with one \">\" shared by every opener", "→" + "<pre ".repeat(REPEAT__) + ">", "→" + "<pre ".repeat(REPEAT__) + ">"],
		["ported from MarkupScanners: no </pre> for any opener", "→" + "<pre>".repeat(REPEAT__), "→" + "<pre>".repeat(REPEAT__)],
		["ported from MarkupScanners: no </code> for any opener", "→" + "<code>".repeat(REPEAT__), "→" + "<code>".repeat(REPEAT__)],
		["ported from MarkupScanners: href/src with every quote followed by \"/\"", "→<p><!--" + "src=\"/".repeat(REPEAT__) + "--></p>", "→<p></p>"],
		["ported from MarkupScanners: one run, no closing quote for any opener", "→" + "src=\"/".repeat(REPEAT__) + "'/ ", "→" + "src=\"/".repeat(REPEAT__) + "'/"],
		["void: one \">\" shared by every tag", "→" + "<br ".repeat(REPEAT__) + ">", "→" + "<br ".repeat(REPEAT__ - 1) + "<br>"],
		["comments: no \"-->\" after any opener", "→" + "<!--x".repeat(REPEAT__), "→" + "<!--x".repeat(REPEAT__)],
		["comments: many ended by \"--!>\", no \"-->\"", "→" + "<!--a--!>".repeat(REPEAT__), "→" + "<!--a--!>".repeat(REPEAT__)],
		["main already does this right: comments: many short ones", "→" + "<!--a-->b".repeat(REPEAT__), "→" + "b".repeat(REPEAT__)],
		["main already does this right: bogus comments: no \">\" after any opener", "→" + "<!x<?y".repeat(REPEAT__), "→" + "<!x<?y".repeat(REPEAT__)],
		["main already does this right: bogus comments: many", "→" + "<?x>".repeat(REPEAT__), "→" + "<?x>".repeat(REPEAT__)],
		["main already does this right: text: many lone \"<\"", "→" + "< ".repeat(REPEAT__), "→" + "< ".repeat(REPEAT__ - 1) + "<"],
		["main already does this right: whitespace: one run after \">\" not followed by \"<\"", "<p>→</p>" + " ".repeat(REPEAT__) + "x", "<p>→</p> x"],
		["main already does this right: whitespace: one run between tags", "<p>→</p>" + " \n\t\r\f".repeat(REPEAT__) + "<p>", "<p>→</p><p>"],
		["main already does this right: whitespace: one run inside a script tag", "<script" + " ".repeat(REPEAT__) + ">→</script>", "<script>→</script>"],
		["main already does this right: attributes: many in one tag", "<p→" + " a = \"1\"".repeat(REPEAT__) + ">", "<p→" + " a=\"1\"".repeat(REPEAT__) + ">"],
		["main already does this right: attributes: one quote never closed", "→<a href=\"" + "x".repeat(REPEAT__), "→<a href=\"" + "x".repeat(REPEAT__)],
		["main already does this right: attributes: one long href", "<a href=\"" + "→".repeat(REPEAT__) + "\">x</a>", "<a href=" + "→".repeat(REPEAT__) + ">x</a>"],
		["main already does this right: tags: many small ones", "<a href=\"/x\">→</a>\n".repeat(REPEAT__ >> 2), "<a href=/x>→</a>".repeat(REPEAT__ >> 2)],
		["main already does this right: tags: one long uppercase name", "<" + "A".repeat(REPEAT__) + "→>", "<" + "A".repeat(REPEAT__) + "→>"],
		["script: many escape openers, no end", "<script>→" + "<!--<script>".repeat(REPEAT__), "<script>→" + "<!--<script>".repeat(REPEAT__)],
		["script: many escaped scripts", "<script><!--</script>→".repeat(REPEAT__ >> 2), "<script><!--</script>→".repeat(REPEAT__ >> 2)],
		["main already does this right: raw text: no end tag, many near misses", "<title>→" + "</titl".repeat(REPEAT__), "<title>→" + "</titl".repeat(REPEAT__)],
		["main already does this right: raw text: many textareas", "<textarea> → </textarea>".repeat(REPEAT__ >> 2), "<textarea> → </textarea>".repeat(REPEAT__ >> 2)],
		["main already does this right: foreign: a deep stack closed in order", "<svg>→" + "<g>".repeat(REPEAT__) + "</g>".repeat(REPEAT__) + "</svg>", "<svg>→" + "<g>".repeat(REPEAT__) + "</g>".repeat(REPEAT__) + "</svg>"],
		["main already does this right: foreign: a deep stack closed at once", "<svg>→" + "<g><a>".repeat(REPEAT__ >> 1) + "</svg><p>x</p>", "<svg>→" + "<g><a>".repeat(REPEAT__ >> 1) + "</svg><p>x</p>"],
		["main already does this right: foreign: CDATA never closed", "<svg>→" + "<![CDATA[".repeat(REPEAT__), "<svg>→" + "<![CDATA[".repeat(REPEAT__)],
		["main already does this right: blocks: one deep pre", "<pre>→" + "<pre>".repeat(REPEAT__) + "</pre>".repeat(REPEAT__ + 1), "<pre>→" + "<pre>".repeat(REPEAT__) + "</pre>".repeat(REPEAT__ + 1)],
		["main already does this right: markers: many U+0001", "→" + "\u0001 ".repeat(REPEAT__), "→" + "\u0001 ".repeat(REPEAT__ - 1) + "\u0001"]
	];

	for (const [name, input, expected] of workloads)
	{
		it(name, () =>
		{
			let output = "";
			const took = cpuMs__(() =>
			{
				output = html(input);
			});

			expect(input.length).toBeGreaterThan(500000);
			expect(difference__(output, expected)).toBeNull();
			expect(took).toBeLessThan(BOUND_MS__);
		});
	}
});
