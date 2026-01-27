export default {
	testEnvironment: "node",
	transform: {},
	collectCoverageFrom: [
		"src/**/*.js",
		"!**/node_modules/**",
	],
	coverageReporters: ["text", "lcov", "cobertura"],
	coverageDirectory: "./.test_output",
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
	reporters: [
		"default",
		["jest-junit", {
			outputDirectory: "./.test_output",
			outputName: "test-results.xml",
			classNameTemplate: "{classname}",
			titleTemplate: "{title}",
			ancestorSeparator: " › ",
			usePathAsClassName: "true"
		}]
	]
};
