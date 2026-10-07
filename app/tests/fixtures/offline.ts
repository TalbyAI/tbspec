import http from "node:http";
import https from "node:https";
import net from "node:net";
function unavailable(): never { throw new Error("Offline test forbids Node network access."); }
globalThis.fetch = unavailable;
http.request = unavailable;
http.get = unavailable;
https.request = unavailable;
https.get = unavailable;
net.connect = unavailable;
net.createConnection = unavailable;
