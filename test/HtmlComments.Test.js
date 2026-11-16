import minify__ from "../src/index.js";

// WI 47221: how the HTML minifier removes comments (src/HtmlComments.js, on the scanner of src/HtmlMinifier.js).
//
// The scanner reads a comment as the HTML parser does: it ends at the first "-->" or "--!>", "<!-->" and "<!--->" are
// whole comments, an unterminated one runs to the end. A terminated comment is vaulted as a tag-like marker and the
// vault records what each marker is (src/HtmlComments.js, MARK_*): a comment the pass may drop, or a construct that is
// not character data (a tag, a DOCTYPE, an element held whole, a <pre>/<code>/<listing> block, the rest of a document
// the scan stopped reading, CDATA, a comment after a CR or a high surrogate). A comment the pass may drop is dropped or kept
// as "<!---->"; the other vaults are put back as written. The old loop that stripped "<!--...-->" from the output until
// nothing changed is gone: it matched across bogus comments, "<!-->", "--!>" and
// CDATA, and deleted real markup. An unterminated comment (it runs to the end of the input) and a bogus comment such as
// "<!x>" or "<?x>" (it runs to its first ">") stay in the text; the whitespace inside them collapses like the text around them, as on main.
//
// After whitespace is collapsed, one pass reads the text again as tokens (character data, a vault that holds text with
// its own restored text, "</>", constructs, comments) and decides each run of adjacent comments, left to right. The
// run is dropped unless dropping it would change what a parser makes of its neighbours, in which case the whole run
// becomes one empty comment, "<!---->" (an empty comment is the same token boundary as the original):
//   (a) the output ends in "<" and the text after the run starts with a letter, "!", "/" or "?": "<<!---->p>" is the
//       text "<", an empty comment and the text "p>", but "<p>" is a tag;
//   (b) the output ends in an open character reference ("&", "&#", then letters and digits) and the text after the run
//       starts with a letter, a digit, "#" or ";": "&am<!---->p;" is the text "&am" and "p;", "&amp;" is "&";
//   (c) (not needed) a CR before and a LF after: a comment after a CR is kept by the scanner;
//   (d) the document has a table tag, and the character data before the run (since the last construct or kept run)
//       and the data after it (up to the next comment or construct) are one whitespace only and one not: a table keeps
//       whitespace it reads in "in table text", moves anything else out, and reads the run between two comments as
//       one piece. "</>" is no construct and no text, but ends a character reference, so the pieces on its two sides
//       are classified apart. NUL alone is ignored there. A document without a table tag has no such text.
// Checked against parse5 over every pair of neighbours in 23 parsing contexts, and through the minifier against
// twins that keep every run (tools of the work item, PLAN.md).

const html = input => minify__(input, "html");

/**
 * @description Checks a table of [input, expected output] pairs.
 * @param {Array<Array<string>>} cases - The pairs.
 */
function expectCases(cases)
{
	for (const [input, expected] of cases)
	{
		expect(html(input), JSON.stringify(input)).toBe(expected);
	}
}

describe("HTML comments (WI 47221): a comment between '<' and what follows stays", () =>
{
	it("H1: a '<' before a comment and a name, '!', '/' or '?' after it", () =>
	{
		expectCases([
			["<<!--x-->p>x</p>", "<<!---->p>x</p>"],
			["a<<!--x-->b", "a<<!---->b"],
			["<<!--x-->/p>", "<<!---->/p>"],
			["<<!--x-->!--y-->", "<<!---->!--y-->"],
			["<<!--x-->?x>", "<<!---->?x>"],
			["<<!--x--><!--y--><!--z-->p>", "<<!---->p>"]
		]);
	});

	it("H1 controls: other neighbours, or the end, drop the comment", () =>
	{
		expectCases([
			["a<<!--x--> b", "a< b"],
			["a<!--x-->b", "ab"],
			["a<<!--x--><b>c</b>", "a<<b>c</b>"],
			["<<!--x-->", "<"],
			["<<!--x-->1", "<1"],
			["<!--x-->p>", "p>"]
		]);
	});

	it("an alias of a vault marker inside a comment is no marker", () =>
	{
		expectCases([
			["<<!--\u00010\u0001-->p>", "<<!---->p>"],
			["a<!--\u00010\u0001-->b", "ab"],
			["a\u00010\u0001<!--x-->b", "a\u00010\u0001b"],
			["<!--\u00010\u0001-->", ""]
		]);
	});

	it("aliases of vault markers in text stay text beside blocks held whole and comments that are dropped or kept", () =>
	{
		// the blocks are vaulted before the scan reaches the comments, so their indexes are not the order in the stream
		expectCases([
			["<!--a--><pre>\u00010\u0001</pre><!--b-->\u00011\u0001<p>y</p>", "<pre>\u00010\u0001</pre>\u00011\u0001<p>y</p>"],
			["\u00010\u0001<!--a--><pre>x</pre><!--b-->\u00011\u0001", "\u00010\u0001<pre>x</pre>\u00011\u0001"],
			["<code>\u00011\u0001<!--k--></code><!--a-->\u00010\u0001<!--b-->\u00011\u0001", "<code>\u00011\u0001<!--k--></code>\u00010\u0001\u00011\u0001"],
			["<textarea>\u00010\u0001</textarea><<!--a-->p>", "<textarea>\u00010\u0001</textarea><<!---->p>"],
			["&am<!--a-->\u00010\u0001p;<pre>\u00011\u0001</pre>", "&am\u00010\u0001p;<pre>\u00011\u0001</pre>"]
		]);
	});
});

describe("HTML comments (WI 47221): a comment inside a character reference stays", () =>
{
	it("H2: the halves of a reference", () =>
	{
		expectCases([
			["&am<!--x-->p;", "&am<!---->p;"],
			["&#<!--x-->x41;", "&#<!---->x41;"],
			["&#x4<!--x-->1;", "&#x4<!---->1;"],
			["&#3<!--x-->2;", "&#3<!---->2;"],
			["&Ta<!--x-->b;", "&Ta<!---->b;"],
			["&amp<!--x-->;", "&amp<!---->;"],
			["&<!--x-->#32;", "&<!---->#32;"],
			["<!--a-->&#x<!--b-->20;", "&#x<!---->20;"]
		]);
	});

	it("H2 controls: a finished reference, or something that cannot continue one, drops the comment", () =>
	{
		expectCases([
			["&amp;<!--x-->b", "&amp;b"],
			["a&<!--x--> b", "a& b"],
			["&am<!--x--> p;", "&am p;"],
			["&<!--x-->", "&"],
			["&amp<!--x-->", "&amp"],
			["a&b<!--x-->-c", "a&b-c"]
		]);
	});
});

describe("HTML comments (WI 47221): what a comment carries across, and what ends it", () =>
{
	it("the open-reference state follows each character", () =>
	{
		expectCases([
			// "#" continues a reference only right after "&"
			["&a#<!--x-->b", "&a#b"],
			["&##<!--x-->b", "&##b"],
			["&#x<!--x-->#", "&#x<!---->#"],

			// a second "&" starts a reference of its own
			["&&<!--x-->amp;", "&&<!---->amp;"]
		]);
	});

	it("a tag, '</>' or a kept comment ends what the text before it carries", () =>
	{
		expectCases([
			["<<b><!--x-->p>", "<<b>p>"],
			["<</><!--x-->p>", "<</>p>"],
			["&<b><!--x-->a", "&<b>a"],
			["&</><!--x-->a", "&</>a"],
			["&a<!--x-->b<!--y-->c", "&a<!---->bc"],

			// "</>" after the comment is nothing: its first character is no letter, but a "<"
			["<<!--x--></>p>", "<</>p>"]
		]);
	});
});

describe("HTML comments (WI 47221): a comment in table text stays where it keeps whitespace apart", () =>
{
	it("H3: whitespace on one side, anything else on the other", () =>
	{
		expectCases([
			["<table>&#32;<!--x-->x</table>", "<table>&#32;<!---->x</table>"],
			["<table>x<!--x-->&#32;</table>", "<table>x<!---->&#32;</table>"],
			["<table> <!--x--> x</table>", "<table> <!----> x</table>"],
			["<table>&#32;</><!--x-->x</table>", "<table>&#32;</><!---->x</table>"],
			["<table>&Ta</>b;<!--x-->&#32;</table>", "<table>&Ta</>b;<!---->&#32;</table>"],
			["<table>&#32;<!--x-->&#32;</>Ā</table>", "<table>&#32;<!---->&#32;</>Ā</table>"],
			["<table><pre>Ā</pre>&#32;<!--x-->x</table>", "<table><pre>Ā</pre>&#32;<!---->x</table>"],
			["<table><tr><td>x</td></tr> <!--x-->text</table>", "<table><tr><td>x</td></tr> <!---->text</table>"]
		]);
	});

	it("H3 controls: both sides alike, nothing, or NUL alone drop the comment", () =>
	{
		expectCases([
			["<table>&#32;<!--x-->&#32;</table>", "<table>&#32;&#32;</table>"],
			["<table>x<!--x-->y</table>", "<table>xy</table>"],
			["<table>&#32;<!--x--></table>", "<table>&#32;</table>"],
			["<table><!--x-->x</table>", "<table>x</table>"],
			["<table>\u0000<!--x-->x</table>", "<table>\u0000x</table>"],
			["<table>&#32;<b></b><!--x-->x</table>", "<table>&#32;<b></b>x</table>"],
			["<table>&#32;<!--x--><!--y-->&#32;</table>", "<table>&#32;&#32;</table>"],
			["<table>&#32;<!--x--><!--y-->x</table>", "<table>&#32;<!---->x</table>"]
		]);
	});

	it("H3: NUL is ignored beside whitespace or text, and is no text alone", () =>
	{
		expectCases([
			["<table>\u0000&#32;<!--x-->x</table>", "<table>\u0000&#32;<!---->x</table>"],
			["<table>x<!--x-->\u0000&#32;</table>", "<table>x<!---->\u0000&#32;</table>"],
			["<table>a\u0000<!--x-->b</table>", "<table>a\u0000b</table>"],
			["<table>\u0000<!--x-->&#32;</table>", "<table>\u0000&#32;</table>"]
		]);
	});

	it("H3: a kept comment starts the data before the next one afresh", () =>
	{
		expectCases([
			["<table>y<!--x-->&#32;<!--z-->w</table>", "<table>y<!---->&#32;<!---->w</table>"],
			["<table>&#32;<!--x-->y<!--z-->w</table>", "<table>&#32;<!---->yw</table>"]
		]);
	});

	it("without a table tag the document has no table text: whitespace next to anything else drops the comment", () =>
	{
		expectCases([
			["<p>&#32;<!--x-->x</p>", "<p>&#32;x</p>"],
			["<p> <!--x-->text</p>", "<p> text</p>"],
			["x<!-- a -->\n<br>", "x <br>"],

			// positive control: any table tag in the document turns the rule on for all of it
			["<p>a</p><table></table><p> <!--x-->text</p>", "<p>a</p><table></table><p> <!---->text</p>"]
		]);
	});
});

describe("HTML comments (WI 47221): which references and characters are whitespace in table text", () =>
{
	it("H3: whitespace as a reference or a character keeps the comment against text", () =>
	{
		const spaces = ["&#9;", "&#10;", "&#12;", "&#13;", "&#32;", "&#x9;", "&#xA;", "&#xc;", "&#X0D;", "&#x20;", "&#0032;", "&#32", "&#x20", "&Tab;", "&NewLine;", " ", "\f"];

		for (const space of spaces)
		{
			const kept = html(`<table>${space}<!--x-->x</table>`);

			expect(kept, JSON.stringify(space)).toBe(`<table>${space}<!---->x</table>`);
			expect(html(`<table>x<!--x-->${space}</table>`), JSON.stringify(space)).toBe(`<table>x<!---->${space}</table>`);
		}
	});

	it("H3 controls: other references and characters are text, so a comment between two of them goes", () =>
	{
		const others = ["&#11;", "&#160;", "&nbsp;", "&#33;", "&#x1F600;", "&amp;", "&#x2028;", "&#31;", "&#14;", "&NewLin;", "\u00A0", "\u000B"];

		for (const other of others)
		{
			expect(html(`<table>${other}<!--x-->x</table>`), JSON.stringify(other)).toBe(`<table>${other}x</table>`);
			expect(html(`<table>x<!--x-->${other}</table>`), JSON.stringify(other)).toBe(`<table>x${other}</table>`);
		}
	});

	it("H3: whitespace and text on both sides, in either order, across several comments", () =>
	{
		expectCases([
			["<table>&#9;<!--x-->&#10;<!--y-->x</table>", "<table>&#9;&#10;<!---->x</table>"],
			["<table>x<!--x-->&#9;<!--y-->&#10;</table>", "<table>x<!---->&#9;&#10;</table>"],
			["<table>&#9;&#10;x<!--x-->&#9;</table>", "<table>&#9;&#10;x<!---->&#9;</table>"],
			["<table>&#32;<!--x-->&#32;x<!--y-->&#32;</table>", "<table>&#32;<!---->&#32;x<!---->&#32;</table>"],
			["<table>&#32;x<!--x--><!--y-->&#32;</table>", "<table>&#32;x<!---->&#32;</table>"]
		]);
	});
});

describe("HTML comments (WI 47221): the table rule is on in a document with any table tag", () =>
{
	it("each tag of the table family turns it on, in any case", () =>
	{
		const tags = ["table", "caption", "col", "colgroup", "tbody", "thead", "tfoot", "tr", "td", "th", "TABLE", "Td", "tBODY"];

		for (const tag of tags)
		{
			expect(html(`<${tag}>&#32;<!--x-->y`), tag).toBe(`<${tag}>&#32;<!---->y`);
		}
	});

	it("controls: tags that are not table tags leave it off", () =>
	{
		for (const tag of ["b", "p", "tt", "t", "tab", "ta", "cap", "co"])
		{
			expect(html(`<${tag}>&#32;<!--x-->y`), tag).toBe(`<${tag}>&#32;y`);
		}
	});
});

describe("HTML comments (WI 47221): a construct that is not character data is no text to a comment next to it", () =>
{
	// With a table in the document, whitespace on one side of a comment and a construct on the other must not keep the
	// comment: the construct is not character data. A scan that did not register it would read it as text and keep it.
	const constructs = [
		["a tag", "<b>"],
		["an end tag", "</b>"],
		["a DOCTYPE", "<!DOCTYPE html>"],
		["a bogus comment", "<!x>"],
		["a processing instruction", "<?x>"],
		["a pre block", "<pre>a</pre>"],
		["a code block", "<code>a</code>"],
		["a listing block", "<listing>a</listing>"],
		["a script", "<script>a</script>"],
		["a style", "<style>a{}</style>"],
		["a textarea", "<textarea>t</textarea>"],
		["foreign CDATA", "<svg><![CDATA[x]]></svg>"]
	];

	// what runs to the end of the document holds the rest: a comment after it is inside it, kept as written
	const toTheEnd = [
		["a block the document never ends", "<pre>a"],
		["an unfinished tag", "<b"],
		["the rest of a document after a latch", "<math><mi><b>y</b></mi></math>"],
		["a block the scan latches", "<pre>a<table>"]
	];

	for (const [name, construct] of constructs)
	{
		it(name, () =>
		{
			const after = `<table></table>&#32;<!--x-->${construct}`;
			const before = `<table></table>${construct}<!--x-->&#32;`;

			expect(html(after), after).toBe(after.replace("<!--x-->", ""));
			expect(html(before), before).toBe(before.replace("<!--x-->", ""));

			// the construct also ends the data on its other side: it is not read across
			const behind = `<table></table>&#32;${construct}<!--x-->y`;
			const ahead = `<table></table>y<!--x-->${construct}&#32;`;

			expect(html(behind), behind).toBe(behind.replace("<!--x-->", ""));
			expect(html(ahead), ahead).toBe(ahead.replace("<!--x-->", ""));
		});
	}

	for (const [name, construct] of toTheEnd)
	{
		it(name, () =>
		{
			const after = `<table></table>&#32;<!--x-->${construct}`;
			const inside = `<table></table>${construct}<!--x-->&#32;`;

			expect(html(after), after).toBe(after.replace("<!--x-->", ""));
			expect(html(inside), inside).toBe(inside);
		});
	}

	it("foreign CDATA is no text on either side of a comment", () =>
	{
		expectCases([
			["<table></table><svg><![CDATA[y]]><!--x-->&#32;</svg>", "<table></table><svg><![CDATA[y]]>&#32;</svg>"],
			["<table></table><svg>&#32;<!--x--><![CDATA[y]]></svg>", "<table></table><svg>&#32;<![CDATA[y]]></svg>"],
			["<table></table><svg>&#32;<![CDATA[y]]><!--x-->z</svg>", "<table></table><svg>&#32;<![CDATA[y]]>z</svg>"],
			["<table></table><svg>z<!--x--><![CDATA[y]]>&#32;</svg>", "<table></table><svg>z<![CDATA[y]]>&#32;</svg>"]
		]);
	});

	it("positive control: the same shapes with text next to the comment keep it", () =>
	{
		expectCases([
			["<table></table>&#32;<!--x-->y", "<table></table>&#32;<!---->y"],
			["<table></table>y<!--x-->&#32;", "<table></table>y<!---->&#32;"]
		]);
	});

	it("a '</' that ends the input is text (the tokenizer emits it), '</' with anything after it is a construct", () =>
	{
		expectCases([
			["<table>&#32;<!--x--></", "<table>&#32;<!----></"],
			["<table> <!--x--></", "<table> <!----></"],
			["<table>&#32;<!--x--></a", "<table>&#32;</a"],
			["<table>&#32;<!--x--></>", "<table>&#32;</>"],
			["a<!--x--></", "a</"]
		]);
	});

	it("a comment inside a block held whole is part of the block: terminated or not, it is neither emitted twice nor read as a comment", () =>
	{
		expectCases([
			["<pre>Ā<!--u", "<pre>Ā<!--u"],
			["<code>a<!--u", "<code>a<!--u"],
			["<listing>q<!--u", "<listing>q<!--u"],
			["<pre>x\r<!--c-->y</pre>", "<pre>x\r<!--c-->y</pre>"],
			["<pre>a<!--b--></pre>c", "<pre>a<!--b--></pre>c"],
			["<pre>a<!--b-->c</pre><!--d-->e", "<pre>a<!--b-->c</pre>e"]
		]);
	});

	it("a '<!' or '<?' that ends the input is a construct (an empty comment node), not text: the comment before it goes", () =>
	{
		expectCases([
			["<table>&#32;<!--x--><!", "<table>&#32;<!"],
			["<table>&#32;<!--x--><?", "<table>&#32;<?"],
			["<table>&#32;<!--x--><!-", "<table>&#32;<!-"],
			["<table>&#32;<!--x--><a", "<table>&#32;<a"]
		]);
	});
});

describe("HTML comments (WI 47221): where a comment ends", () =>
{
	it("H3: '-->', '--!>', '<!-->' and '<!--->' end it; nothing after it is eaten", () =>
	{
		expectCases([
			["x<!--y--!>z<!-->w<!--->v", "xzwv"],
			["<!--a--!><p>x</p><!--b-->", "<p>x</p>"],
			["<p>a<!--b<!--c-->d-->e</p>", "<p>ad-->e</p>"],
			["<!--<!--x-->-->", "-->"],
			["a<!----><!--z", "a<!--z"],
			["<!--x-->\n<!--y-->\n<p>z</p>", "<p>z</p>"]
		]);
	});

	it("an unterminated comment runs to the end of the input; a bogus comment and a CDATA section outside foreign content to their first '>'", () =>
	{
		expectCases([
			["a<!--x<p>y</p>", "a<!--x<p>y</p>"],
			["<p>a<!--b--><!--c <i>d</i>", "<p>a<!--c <i>d</i>"],
			["<![CDATA[<!--x--><p>y</p>", "<![CDATA[<!--x--><p>y</p>"],
			["<svg><![CDATA[<!--x--><p>y</p>]]></svg>", "<svg><![CDATA[<!--x--><p>y</p>]]></svg>"],
			["<!<!---->-->-->", "<!<!---->-->-->"],
			["<?x <!--y--> ?>z", "<?x <!--y--> ?>z"],
			["<p>a</p><!<!--x-->b<!--y-->", "<p>a</p><!<!--x-->b"]
		]);
	});

	it("whitespace on both sides of a dropped comment stays as it is (two spaces)", () =>
	{
		expectCases([
			["a <!--x--> b", "a  b"],
			["<p>a</p> <!--x--> <p>b</p>", "<p>a</p><p>b</p>"]
		]);
	});
});

describe("HTML comments (WI 47221): character data a vault holds counts by what it holds", () =>
{
	it("a preserved svg run before or after a comment", () =>
	{
		expectCases([
			["<svg xml:space=preserve>a<<!--x-->b</svg>", "<svg xml:space=preserve>a<<!---->b</svg>"],
			["<svg xml:space=preserve>&am<!--x-->p;</svg>", "<svg xml:space=preserve>&am<!---->p;</svg>"],
			["<svg xml:space=preserve>a<<!--x--><b>c</b></svg>", "<svg xml:space=preserve>a<<b>c</b></svg>"],

			// control: a space is no start of a tag
			["<svg xml:space=preserve>a<<!--x--> b</svg>", "<svg xml:space=preserve>a< b</svg>"]
		]);
	});

	it("white-space in the document keeps every run of whitespace, and the rules on '<' and '&' still apply", () =>
	{
		expectCases([
			["<p style=\"white-space:pre\">a<<!--x-->b</p>", "<p style=\"white-space:pre\">a<<!---->b</p>"],
			["<p style=\"white-space:pre\">&am<!--x-->p;</p>", "<p style=\"white-space:pre\">&am<!---->p;</p>"],
			["<p style=\"white-space:pre\">a \n<!--x-->  b</p>", "<p style=\"white-space:pre\">a \n  b</p>"],
			["<table style=\"white-space:pre\">\n<!--x-->x</table>", "<table style=\"white-space:pre\">\n<!---->x</table>"]
		]);
	});

	it("a comment after a CR or a high surrogate is kept as written (47101), and breaks a run", () =>
	{
		expectCases([
			["\r<!--x-->\ny", "<!--x--> y"],
			["a\r<!--x--><!--y-->\nb", "a\r<!--x--> b"],
			["a\uD83D<!--x-->\uDE00b", "a\uD83D<!--x-->\uDE00b"]
		]);
	});
});
