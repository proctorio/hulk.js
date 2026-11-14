const MARK__ = "\u0001";
const MARKER__ = new RegExp(`${MARK__}(\\d+)${MARK__}`, "gu");

/**
 * @description Stores a protected span and returns the marker that stands for it.
 * @param {Array<string>} spans - The vault's spans, in marker order.
 * @param {string} text - Span to protect.
 * @return {string} MARK, the span's decimal index, MARK.
 */
function vault__(spans, text)
{
	spans.push(text);

	return `${MARK__}${spans.length - 1}${MARK__}`;
}

/**
 * @description Puts every vaulted span back in one pass.
 * @param {Array<string>} spans - The vault's spans.
 * @param {string} content - Text holding markers.
 * @return {string} The text with each marker replaced by its span.
 */
function restoreVault__(spans, content)
{
	return content.replaceAll(MARKER__, (marker, index) => spans[Number(index)]);
}

export { MARK__, restoreVault__, vault__ };
