/**
 * Creates the Socket.
 */
export var createSocket = function (host, port, options) {
  return new TCPSocket(host, port, options);
};

/**
 * Creates the Server.
 */
export var createServer = function (port, options, backlog) {
  return new TCPServerSocket(port, options, backlog);
};

// See test_tcpsocket_client_and_server_basics.html's version for rationale.
/**
 * Handles the firefox socket Compartment Instance Of Array Buffer workflow.
 */
export var socketCompartmentInstanceOfArrayBuffer = function (obj) {
  return obj instanceof ArrayBuffer;
};
