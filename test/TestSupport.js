/**
 * @description Compares two strings without handing multi-megabyte values to the assertion library, whose diff of them
 * would take minutes.
 * @param {string} actual - Actual string.
 * @param {string} expected - Expected string.
 * @return {?string} Null when equal; otherwise the lengths and the first difference, short.
 */
function difference__(actual, expected)
{
	if (actual === expected) return null;

	let index = 0;

	while (index < actual.length && actual[index] === expected[index]) index++;

	return `lengths ${actual.length}/${expected.length}, first difference at ${index}: ${JSON.stringify(actual.slice(index, index + 40))} vs ${JSON.stringify(expected.slice(index, index + 40))}`;
}

/**
 * @description Runs a function and returns the CPU time this process spent on it. Unlike wall time, this does not grow
 * when a busy machine deschedules the test, so a bound on it fails only when the work itself grows.
 * @param {Function} run - Function to time.
 * @return {number} Milliseconds of user and system CPU time.
 */
function cpuMs__(run)
{
	const start = process.cpuUsage();

	run();

	const spent = process.cpuUsage(start);

	return (spent.user + spent.system) / 1000;
}

export { cpuMs__, difference__ };
