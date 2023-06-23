const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const fs = require("fs");
const axios = require('axios')
const { Console } = require("console");
const path = "sessions/";
let x;

exports.gas = function (msg, no, to, type) {
  connect(msg, no, to, type);
};
exports.sendMessage = function (msg, no, to, type, mediaUrl, mediaType, filename, mimeType) {
  sendMessage(msg, no, to, type, mediaUrl, mediaType, filename, mimeType);
};

async function connect(msg, sta, to, type, mediaUrl, mediaType, filename, mimeType, callback = () => {}) {
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
      callback(msg, sta, to, type, mediaUrl, mediaType, filename, mimeType)
    }
  });

  sock.ev.on('messages.upsert', async (message) => {
    if (!message.messages[0]) return

    const isWebhook = global.webhook.find((x) => x.id == sta)
    if(!isWebhook) return

    const msg = require('./Message')(sock, message.messages[0])

    let data = {}
    data.type = msg.isMedia ? 'media' : 'message'
    data.session = sta
    data.message = msg

    if(msg.isMedia) {
      const media = await msg.getMedia()
			data.base64_media = media.toString('base64')
    }

    axios.post(isWebhook.webhook, data)
  })

  sock.ev.on("creds.update", saveCreds);

  return sock
}

async function sendMessage(msg, sta, to, type, mediaUrl, mediaType, filename = '', mimeType) {
  if(global.sessions[sta] == undefined) {
    return await connect(msg, sta, to, type, mediaUrl, mediaType, filename, mimeType, sendMessage);
  }
  
  if (to != null) {
    const id = to + "@s.whatsapp.net";
    if (type === "chat" && msg != null) {
      global.sessions[sta].sendMessage(id, {
        text: msg,
      });
    } else if(type == 'media') {
      global.sessions[sta].sendMessage(id, {
        [mediaType]: { url: mediaUrl },
        fileName: filename,
        mimetype: mimeType,
        caption: msg
      })
    }
  }
}