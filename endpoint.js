const {
    proto,
    jidDecode,
    DisconnectReason,
    makeInMemoryStore,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    downloadContentFromMessage,
    getAggregateVotesInPollMessage,
    generateWAMessageFromContent,
    generateForwardMessageContent,
    default: makeWASocket
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const NodeCache = require("node-cache");
const chalk = require("chalk");
const util = require("util");
const express = require("express");
const app = express();

const port = process.env.PORT || 3000; // Gunakan PORT dari environment

const usePairingCode = true;

// Middleware untuk parsing JSON
app.use(express.json());

async function question(text) {
    return new Promise((resolve) => {
        const readline = require("readline").createInterface({
            input: process.stdin,
            output: process.stdout
        });
        readline.question(text, (answer) => {
            readline.close();
            resolve(answer);
        });
    });
}

async function connectToWhatsApp() {
    const store = makeInMemoryStore({
        logger: pino().child({ level: "silent", stream: "store" }),
    });

    const { state, saveCreds } = await useMultiFileAuthState("session");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        auth: state,
        browser: ["Linux", "Chrome", "20.0.04"],
        printQRInTerminal: !usePairingCode,
    });

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
            console.log(chalk.red(`[ ERROR ] Connection closed: ${reason}`));
            connectToWhatsApp();
        }
    });

    sock.ev.process(async (events) => {
        if (events["presence.update"]) {
            await sock.sendPresenceUpdate("available");
        }
        if (events["creds.update"]) {
            await saveCreds();
        }
    });

    return sock;
}

let sock;
(async () => {
    sock = await connectToWhatsApp();
})();

// Endpoint untuk mengirim pesan
app.post("/send-message", async (req, res) => {
    const { jid, message } = req.body;

    if (!jid || !message) {
        return res.status(400).json({ success: false, message: "Field 'jid' dan 'message' wajib diisi." });
    }

    try {
        await sock.sendMessage(jid, { text: message });
        res.status(200).json({ success: true, message: "Pesan berhasil dikirim." });
    } catch (error) {
        console.error("Gagal mengirim pesan:", error);
        res.status(500).json({ success: false, message: "Terjadi kesalahan saat mengirim pesan." });
    }
});

// Jalankan server
app.listen(port, () => {
  console.log(`Server berjalan di port ${port}`);
});
