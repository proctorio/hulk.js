export default {
	testEnvironment: "node",
	transform: {},
	collectCoverageFrom: [
		"src/**/*.js",
		"!**/node_modules/**",
	],
	coverageThreshold: {
		global: {
			branches: 80,
			functions: 80,
			lines: 80,
			statements: 80,
		},
	},
	testMatch: [
		"**/test/**/*.Test.js",
	],
};
