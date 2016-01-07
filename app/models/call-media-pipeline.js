var kurento = require('kurento-client');
var UserRegistry = require('./user-registry');

/* command line arguments */
var argv = require('../config/argv');
// TODO refactor somehow
var kurentoClient = null;
var candidatesQueue = require('./candidates-queue');
var userRegistry = UserRegistry;

function getKurentoClient(callback) {
	if(kurentoClient !== null) {
		return callback(null, kurentoClient);
	}
	
	kurento(argv.wsUri, function(error, _kurentoClient) {
		if(error) {
			var message =
				"Unable to find media server at " + argv.wsUri;
			console.log(message);
			
			return callback(message + ".  Exiting with error " + error);
		}
		
		kurentoClient = _kurentoClient;
		callback(null, kurentoClient);
	});
};

function CallMediaPipeline() {
	this.pipeline = null;
	this.webRtcEndpoint = {};
};

CallMediaPipeline.prototype.createPipeline = function(callerId, calleeId, callback) {
    var self = this;
    getKurentoClient(function(error, kurentoClient) {
        if(error) {
        	return callback(error);
        }

        kurentoClient.create('MediaPipeline', function(error, pipeline) {
            if(error) {
                return callback(error);
            }

            pipeline.create('WebRtcEndpoint', function(error, callerWebRtcEndpoint) {
                if(error) {
                    pipeline.release();
                    return callback(error);
                }

                if(candidatesQueue[callerId]) {
                    while(candidatesQueue[callerId].length) {
                        var candidate = candidatesQueue[callerId].shift();
                        callerWebRtcEndpoint.addIceCandidate(candidate);
                    }
                }

                callerWebRtcEndpoint.on('OnIceCandidate', function(event) {
                    var candidate = kurento.register.complexTypes.IceCandidate(event.candidate);
                    userRegistry.getById(callerId).ws.send(JSON.stringify({
                        id : 'iceCandidate',
                        candidate : candidate
                    }));
                });

                pipeline.create('WebRtcEndpoint', function(error, calleeWebRtcEndpoint) {
                    if(error) {
                        pipeline.release();
                        
                        return callback(error);
                    }

                    if(candidatesQueue[calleeId]) {
                        while(candidatesQueue[calleeId].length) {
                            var candidate = candidatesQueue[calleeId].shift();
                            calleeWebRtcEndpoint.addIceCandidate(candidate);
                        }
                    }

                    calleeWebRtcEndpoint.on('OnIceCandidate', function(event) {
                        var candidate = kurento.register.complexTypes.IceCandidate(event.candidate);
                        userRegistry.getById(calleeId).ws.send(JSON.stringify({
                            id : 'iceCandidate',
                            candidate : candidate
                        }));
                    });

                    callerWebRtcEndpoint.connect(calleeWebRtcEndpoint, function(error) {
                        if (error) {
                            pipeline.release();
                            
                            return callback(error);
                        }

                        calleeWebRtcEndpoint.connect(callerWebRtcEndpoint, function(error) {
                            if (error) {
                                pipeline.release();
                                
                                return callback(error);
                            }
                        });

                        self.pipeline = pipeline;
                        self.webRtcEndpoint[callerId] = callerWebRtcEndpoint;
                        self.webRtcEndpoint[calleeId] = calleeWebRtcEndpoint;
                        callback(null);
                    });
                });
            });
        });
    });
};

CallMediaPipeline.prototype.generateSdpAnswer = function(id, sdpOffer, callback) {
    this.webRtcEndpoint[id].processOffer(sdpOffer, callback);
    this.webRtcEndpoint[id].gatherCandidates(function(error) {
        if (error) {
            return callback(error);
        }
    });
};

CallMediaPipeline.prototype.release = function() {
	if(this.pipeline) {
    	this.pipeline.release();
	}
    
	this.pipeline = null;
};

module.exports = CallMediaPipeline;