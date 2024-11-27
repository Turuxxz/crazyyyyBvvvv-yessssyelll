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
const {
	Boom
} = require("@hapi/boom")
const pino = require("pino");
const NodeCache = require("node-cache");
const chalk = require("chalk");
const util = require("util")
const express = require('express');
const app = express();
const port = 3000;

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
        logger: pino().child({
            level: "silent",
            stream: "store"
        })
    });

    const { state, saveCreds } = await useMultiFileAuthState("session");
    const { version, isLatest } = await fetchLatestBaileysVersion();
    const resolveMsgBuffer = new NodeCache();

    const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        auth: state,
        browser: ["Linux", "Chrome", "20.0.04"],
        printQRInTerminal: !usePairingCode,
        resolveMsgBuffer: true,
    });

	if (usePairingCode && !sock.authState.creds.registered) {
		let code = ""
		let phone = await question("[❗ ] MASUKAN NOMOR TELPON\n\n ✅  EXAMPLE : 62814771231019\n ✅  EXAMPLE : 0814771231019\n ✅  EXAMPLE : +62-8147-7123-1019\n\n 🈴  NOMOR LU : ")
		let remakeNumber = (util.format(phone).replace(new RegExp("[()+-/ +/]", "gi"), "")).trim()
		let phoneNumber = remakeNumber.startsWith("08") ? remakeNumber.replace("08", "628") : remakeNumber
		let data = Array.from(await sock.requestPairingCode(phoneNumber))
		for (const x of data) {
			if (code.length == 4) code += "-"
			code += x
		}
		console.log(chalk.keyword("aqua")("[ CODE WHATSAPP ]"), code)
	}

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "close") {
            const reason = new Boom(lastDisconnect?.error)?.output.statusCode;

            switch (reason) {
                case DisconnectReason.badSession:
                    console.log(chalk.red("[ ERROR ] Bad Session File. Please delete session and scan again."));
                    break;
                case DisconnectReason.connectionClosed:
                    console.log(chalk.red("[ ERROR ] Connection closed, reconnecting..."));
                    break;
                case DisconnectReason.connectionLost:
                    console.log(chalk.red("[ ERROR ] Connection lost from server, reconnecting..."));
                    break;
                case DisconnectReason.connectionReplaced:
                    console.log(chalk.red("[ ERROR ] Connection replaced, another session opened. Logging out..."));
                    sock.logout();
                    return;
                case DisconnectReason.loggedOut:
                    console.log(chalk.red("[ ERROR ] Logged out. Please repair your session."));
                    sock.logout();
                    return;
                case DisconnectReason.restartRequired:
                    console.log(chalk.red("[ ERROR ] Restart required, restarting..."));
                    break;
                case DisconnectReason.timedOut:
                    console.log(chalk.red("[ ERROR ] Connection timed out, reconnecting..."));
                    break;
                default:
                    console.log(chalk.red("[ ERROR ] Unknown disconnect reason. Reconnecting..."));
                    break;
            }

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

let sock; // Variabel untuk menyimpan socket

(async () => {
    sock = await connectToWhatsApp();
})();

// Endpoint untuk mengirim pesan
app.post('/send-message', async (req, res) => {
    const { jid, message } = req.body;

    if (!jid || !message) {
        return res.status(400).json({ success: false, message: 'Field "jid" dan "message" wajib diisi.' });
    }

    try {
        await sock.sendMessage(jid, { text: message });
        res.status(200).json({ success: true, message: 'Pesan berhasil dikirim.' });
    } catch (error) {
        console.error('Gagal mengirim pesan:', error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengirim pesan.' });
    }
});

// Jalankan server
app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
});