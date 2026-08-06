import WebSocket from "ws";

export function websocketUrl(baseUrl, path) {
  const url = new URL(baseUrl);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  else throw new Error(`unsupported WebSocket protocol: ${url.protocol}`);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
  url.search = "";
  return url.toString();
}

export function closeSocket(socket) {
  if (!socket) return;
  if (socket.readyState === WebSocket.OPEN) socket.close(1000);
  else if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
}

export function waitForOpen(socket, label) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("open", opened);
      socket.off("error", failed);
      socket.off("unexpected-response", rejected);
      socket.off("close", closed);
    };
    const opened = () => {
      cleanup();
      resolve();
    };
    const failed = (error) => {
      cleanup();
      reject(error);
    };
    const rejected = (request, response) => {
      request.destroy();
      cleanup();
      reject(new Error(`${label} rejected the tunnel (HTTP ${response.statusCode})`));
    };
    const closed = (code, reason) => {
      cleanup();
      reject(new Error(`${label} closed during startup (${code}): ${reason.toString()}`));
    };
    socket.once("open", opened);
    socket.once("error", failed);
    socket.once("unexpected-response", rejected);
    socket.once("close", closed);
  });
}

export function socketSend(socket, data) {
  return new Promise((resolve, reject) => {
    socket.send(data, (error) => error ? reject(error) : resolve());
  });
}
