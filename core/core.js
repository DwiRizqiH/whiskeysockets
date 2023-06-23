const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const fs = require("fs");
const { Console } = require("console");
const path = "sessions/";
let x;

exports.gas = function (msg, no, to, type) {
  connect(msg, no, to, type);
};
exports.sendMessage = function (msg, no, to, type) {
  sendMessage(msg, no, to, type);
};

async function connect(msg, sta , to, type) {
  const { state, saveCreds } = await useMultiFileAuthState(path.concat(sta));

  const sock = makeWASocket({
    auth: state,
    defaultQueryTimeoutMs: undefined,
    logger: pino({ level: "fatal" }),
    browser: ["FFA", "EDGE", "1.0"],
  });
  global.sessions[sta] = sock;

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (connection == "connecting") return;

    if (connection === "close") {
      let statusCode = lastDisconnect.error?.output?.statusCode;

      if (statusCode === DisconnectReason.restartRequired) {
        return;
      } else if (statusCode === DisconnectReason.loggedOut) {
        if (fs.existsSync(path.concat(sta))) {
          fs.unlinkSync(path.concat(sta));
        }
        return;
      }
    } else if (connection === "open") {
      if (msg != null && to != null) {

        const id = to + "@s.whatsapp.net";
        if (type === "chat") {
          sock.sendMessage(id, {
            text: msg,
          });
        }
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  return sock
}

async function sendMessage(msg, sta, to, type) {
  if(global.sessions[sta] == undefined) await connect(sta, msg, to, type);
  
  if (msg != null && to != null) {
    const id = to + "@s.whatsapp.net";
    if (type === "chat") {
      global.session[sta].sendMessage(id, {
        text: msg,
      });
    }
  }
}