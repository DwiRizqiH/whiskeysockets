const {
  default: makeWASocket,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");

process.setMaxListeners(0);

const http = require("http");
const express = require("express");
const bodyParser = require("body-parser");
const port = 9000;
const fs = require("fs");
const qrcode = require("qrcode");
const pino = require("pino");
const socketIO = require("socket.io");

const con = require("./core/core.js");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

global.qr = []

// save session to reuse
global.sessions = {}
fs.readFile('./db/webhook.json', 'utf8', function (err, data) {
  if (err) {
    console.log(err);
  } else {
    global.webhook = JSON.parse(data);
  }
});

// config cors
// const io = require("socket.io")(server, {
//   cors: {
//     origin: "https://stiker-label.com",
//     methods: ["GET", "POST"],
//     credentials: true,
//   },
// });

let x;

const path = "sessions/";

const { body, validationResult } = require("express-validator");

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

io.on("connection", (socket) => {
  socket.on("StartConnection", async (device) => {
    if ((fs.existsSync(path.concat(device)) && fs.existsSync(path.concat(device).concat("/creds.json"))) || global.sessions[device] != undefined) {
      if(global.sessions[device] == undefined) con.gas(null, device);
      socket.emit("message", "Whatsapp connected");
      socket.emit("ready", device);
    } else {
      const { state, saveCreds } = await useMultiFileAuthState(
        path.concat(device)
      );

      const sock = makeWASocket({
        printQRInTerminal: false,
        auth: state,
        logger: pino({ level: "fatal" }),
        browser: ["FFA", "EDGE", "1.0"],
      });
      sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr, isNewLogin } = update;

        if (qr) {
          qrcode.toDataURL(qr, (err, url) => {
            socket.emit("qr", url);
            socket.emit("message", "QR Code received, scan please!");
          });
        }

        if (connection == "close") {
          con.gas(null, device);
          console.log(device);
          socket.emit("message", "Whatsapp connected");
          socket.emit("ready", device);
        }
        console.log(connection);
      });
      sock.ev.on("creds.update", saveCreds);
    }
  });

  socket.on("LogoutDevice", (device) => {
    if (fs.existsSync(path.concat(device))) {
      fs.rmdirSync(path.concat(device), { recursive: true });
      console.log("logout device " + device);

      socket.emit("message", "logout device " + device);
    }
    return;
  });
});

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/core/home.html");
});

app.get("/device", (req, res) => {
  res.sendFile(__dirname + "/core//device.html");
});

app.get("/scan/:id", (req, res) => {
  res.sendFile(__dirname + "/core//index.html");
});

app.post('/start',
[
  body("id").notEmpty(),
  body("webhook").optional().isURL(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({ msg }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped(),
    });
  } else {
    var id = req.body.id;
    var webhook = req.body.webhook;

    if(global.sessions[id] != undefined) {
      return res.status(200).json({
        status: true,
        message: "Device already started",
      });
    }
    if(webhook) {
      const isExistWebhook = global.webhook.findIndex((e) => e.id == id);
      isExistWebhook != -1 ? global.webhook[isExistWebhook].webhook = webhook : global.webhook.push({ id, webhook });
    }

    con.gas(null, id);
    return res.status(200).json({
      status: true,
      message: "Device started",
    });
  }
})

app.get("/qrcode", async (req, res) => {
  var id = req.query.id;
  if(global.sessions[id] == undefined) {
    res.writeHead(401, {
      "Content-Type": "application/json",
    });
    return res.end(
      JSON.stringify({
        status: false,
        message: "Device not started",
      })
    );
  } else if (global.qr[id] == undefined) {
    res.writeHead(401, {
      "Content-Type": "application/json",
    });
    return res.end(
      JSON.stringify({
        status: false,
        message: "QR Code not found",
      })
    );
  } else {
    res.writeHead(200, {
      "Content-Type": "application/json",
    });
    return res.end(
      JSON.stringify({
        status: true,
        message: "QR Code found",
        data: global.qr[id],
      })
    );
  }
})

app.post(
  "/send",
  [
    body("number").notEmpty(),
    body("message"),
    body("to").notEmpty(),
    body("type").notEmpty(),
    body("url").optional().isURL(),
    body("mediatype").optional(),
    body("filename").optional(),
    body("mimetype").optional()
  ],
  async (req, res) => {
    const errors = validationResult(req).formatWith(({ msg }) => {
      return msg;
    });

    if (!errors.isEmpty()) {
      return res.status(422).json({
        status: false,
        message: errors.mapped(),
      });
    } else {
      var number = req.body.number;
      var to = req.body.to;
      var type = req.body.type;
      var msg = req.body.message;
      var url = req.body.url;
      var mediatype = req.body.mediatype;
      var filename = req.body.filename;
      var mimetype = req.body.mimetype;

      if(type == 'media' && (url == undefined || mediatype == undefined) || (mediatype == 'document' && mimetype == undefined)) {
        res.writeHead(401, {
          "Content-Type": "application/json",
        });
        return res.end(
          JSON.stringify({
            status: false,
            message: (mediatype == 'document' && mimetype == undefined) ? "mediatype document need mimetype" : "mediatype and url is required",
          })
        );
      } else if(type == 'chat' && msg == undefined) {
        res.writeHead(401, {
          "Content-Type": "application/json",
        });
        return res.end(
          JSON.stringify({
            status: false,
            message: "message is required",
          })
        );
      }

      if(global.sessions[number] == undefined) {
        res.writeHead(401, {
          "Content-Type": "application/json",
        });
        return res.end(
          JSON.stringify({
            status: false,
            message: "Device not started",
          })
        );
      }

      if (fs.existsSync(path.concat(number))) {
        await con.sendMessage(msg, number, to, type, url, mediatype, filename, mimetype).then((result) => {
          console.log(result);
          res.writeHead(200, {
            "Content-Type": "application/json",
          });
          res.end(
            JSON.stringify({
              status: true,
              message: "success",
            })
          );
        }).catch((error) => {
          res.writeHead(401, {
            "Content-Type": "application/json",
          });
          res.end(
            JSON.stringify({
              status: false,
              message: error,
            })
          );
        });
        // } else {
        //   res.writeHead(401, {
        //     "Content-Type": "application/json",
        //   });
        //   res.end(
        //     JSON.stringify({
        //       status: false,
        //       message: "input type to is not array value",
        //     })
        //   );
        // }
      } else {
        res.writeHead(401, {
          "Content-Type": "application/json",
        });
        res.end(
          JSON.stringify({
            status: false,
            message: "Please scan the QR before use the API",
          })
        );
      }
    }
  }
);

app.post("/device", (req, res) => {
  const no = req.body.device;
  const webhook = req.body.webhook || undefined
  if(webhook) global.webhook.push({ id: no, webhook: webhook })
  res.redirect("/scan/" + no);
});

server.listen(port, function () {
  console.log("App running on : " + port);
});

// save global.webhook to webhook.json when process exit or crash
process.on("exit", function () {
  fs.writeFileSync("./db/webhook.json", JSON.stringify(global.webhook));
});

process.on("SIGINT", function () {
  fs.writeFileSync("./db/webhook.json", JSON.stringify(global.webhook));
  process.exit();
})

process.on("uncaughtException", function (err) {
  console.error(err);
  fs.writeFileSync("./db/webhook.json", JSON.stringify(global.webhook));
  process.exit();
})

process.on("unhandledRejection", function (err) {
  console.error(err);
  fs.writeFileSync("./db/webhook.json", JSON.stringify(global.webhook));
  process.exit();
})
