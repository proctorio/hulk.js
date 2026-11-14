import { MARK__, restoreVault__, vault__ } from "../src/Vault.js";

// The vault (src/Vault.js) keeps spans a minifier must not touch out of reach of its global rules:
// each span becomes MARK + decimal index + MARK, with MARK = U+0001. A scanner vaults every U+0001
// in its input as its own span, so every MARK left in the text belongs to a marker. Restoring is one
// replaceAll with a callback: a span's text is never read as a replacement pattern ("$&", "$$") and
// never scanned again, so a span holding a marker-like text comes back as written.

describe("vault", () =>
{
	test("markers are MARK, index, MARK in insertion order", () =>
	{
		const spans = [];

		expect(vault__(spans, "a")).toBe(`${MARK__}0${MARK__}`);
		expect(vault__(spans, "b")).toBe(`${MARK__}1${MARK__}`);
		expect(spans).toEqual(["a", "b"]);
	});

	test("restore puts every span back in one pass", () =>
	{
		const spans = [];
		const text = `x${vault__(spans, "$&")}y${vault__(spans, "$$")}z${vault__(spans, `${MARK__}0${MARK__}`)}`;

		expect(restoreVault__(spans, text)).toBe(`x$&y$$z${MARK__}0${MARK__}`);
	});

	test("adjacent markers and many spans restore exactly", () =>
	{
		const spans = [];
		const parts = Array.from({ length: 1200 }, (unused, index) => `<${index}>`);
		const text = parts.map(part => vault__(spans, part)).join("");

		expect(restoreVault__(spans, text)).toBe(parts.join(""));
	});
});
