var candidatesQueue = {};

function CandidatesQueue() {
	
};

function clearCandidatesQueue(sessionId) {
	if(candidatesQueue[sessionId]) {
		delete candidatesQueue[sessionId];
	}
};

module.exports = candidatesQueue;
module.exports.clearCandidatesQueue = clearCandidatesQueue;