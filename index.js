"use strict";

/*

*/

var Readable = require('readable-stream'),
    url = require('url');

module.exports = ReqStream;

function ReqStream (options){
  var stream = this,
      haveReaders = false,
      servers = ((arguments.length < 2)? ["http"]: [].slice.call(arguments, 1));

  if(!stream instanceof ReqStream){
    return new ReqStream().forServers(servers);
  }

  stream = Readable.call(this, {
    objectMode: true,
    highWaterMark: options.highWaterMark || 1024 // <-- this is arbitrary, but I suspect we need a high one
  });

  // all arguments should be or define either http(s) or http2 servers
  servers = servers.map( function(arg){
      var httplike,
          protocol,
          host,
          port;
      if( arg && !'function' === typeof arg.on ) {
        if('string' === typeof arg) {
          arg = url.parse(arg, true, true);
        }

        // we need a protocol, hostname, and port to listen on
        protocol = arg.module || arg.protocol.replace(":", "") || options.module;
        httplike = require(protocol);
        host = arg.hostname || options.hostname || '0.0.0.0';
        port = arg.port || options.port || 80;
        arg = httplike.createServer(arg.options || arg.query || options[protocol]);
        setImmediate(function(){
          // TODO: plan to refactor this whole server definition API - it exists
          // only as a convenience and may be of questionable value
          arg.listen(port, host);
        });
      }

      if( !(arg && 'function' === typeof arg.on) ) {
        throw new Error('ReqStream expects an http, https, or http2 server.');
      }

      return arg;
    });

  stream._read = function ReqStream_read(){
    // listen for requests on our servers until we hit the highWaterMark,
    // then remove the listeners.
    servers.forEach( connectServerToStream );
  };

  function connectServerToStream(aServer) {
    // remove the listener before readding it, just to make sure that
    // we don't add it more than once.
    aServer.removeListener('request', sendRequstFromServerToStream);
    aServer.on('request', sendRequstFromServerToStream);
  }

  function sendRequstFromServerToStream(req, res) {
    var context = {
      request: req,
      response: res
    };
    if(!stream.push(context)) {
      // we couldn't put the request context on the stream - we are over
      // the highWaterMark. Stop listening. This should only happen if we
      // are recieving more traffic than our server can handle. (Note that
      // the next call to _read will cause us to start listening again.)
      servers.forEach( disconnectServerFromStream );

      // emit an event, in case the user wants to log that this has happened
      // or handle the response in their own way.
      stream.emit('unavailble', context);

      if(!res.finished) {
        res.writeHead(503, "Service Unavailble");
        res.end();
      }
    }
  }

  function disconnectServerFromStream(aServer){
    aServer.removeListener('request', sendRequstFromServerToStream);
  }

  return stream;
}
ReqStream.prototype = Object.create( new Readable({
  objectMode: true
}));
ReqStream.prototype.constructor = ReqStream;
