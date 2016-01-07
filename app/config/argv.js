var minimist = require('minimist');
var Constants = require ('../constants');

var argv = minimist(process.argv.slice(2), {
	default: {
		asUri: Constants.AS_URI,
		wsUri: Constants.WS_URI
	}
});

module.exports = argv;