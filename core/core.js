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
const qrcode = require("qrcode");
let x;

exports.gas = function (msg, no, to, type) {
  connect(msg, no, to, type);
};
exports.sendMessage = async function (msg, no, to, type, mediaUrl, mediaType, filename, mimeType) {
  return await sendMessage(msg, no, to, type, mediaUrl, mediaType, filename, mimeType);
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
  if(global?.sessions?.[sta]) global.sessions[sta].state = 'connecting'

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (connection == "connecting") return;

    if (connection === "close") {
      if(global?.sessions?.[sta]) global.sessions[sta].state = 'close'
      let statusCode = lastDisconnect.error?.output?.statusCode;

      if (statusCode === DisconnectReason.restartRequired) {
        sock.end()
        return connect(msg, sta, to, type, mediaUrl, mediaType, filename, mimeType, callback)
      } else if (statusCode === DisconnectReason.loggedOut) {
        delete global.sessions[sta];
        if (fs.existsSync(path.concat(sta))) {
          fs.rmSync(path.concat(sta), { recursive: true });
        }
        return;
      }
    } else if (connection === "open") {
      delete global.qr[sta]
      if(global?.sessions?.[sta]) global.sessions[sta].state = 'open'
      callback(msg, sta, to, type, mediaUrl, mediaType, filename, mimeType)
    }

    if (qr) {
      if(global?.sessions?.[sta]) global.sessions[sta].state = 'qr'
      qrcode.toDataURL(qr, (err, url) => {
        global.qr[sta] = url;

        const isWebhook = global.webhook.find((x) => x.id == sta)
        if(isWebhook) {
          axios.post(isWebhook.webhook, { type: 'qr', session: sta, qr: url }).catch((error) => {
            console.error(`[ Webhook error ${sta} ]`, error)
          })
        } 
      })
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

    axios.post(isWebhook.webhook, data).catch((error) => {
      console.error(`[ Webhook error ${sta} ]`, error)
    })
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
      return await global.sessions[sta].sendMessage(id, {
        text: msg,
      });
    } else if(type == 'media') {
      return await global.sessions[sta].sendMessage(id, {
        [mediaType]: { url: mediaUrl },
        fileName: filename,
        mimetype: mimeType,
        caption: msg
      })
    }
  }
}