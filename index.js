import express from "express";
import pkg from "whatsapp-web.js";
import qrcode from "qrcode";
import fs from "fs";

const { Client, LocalAuth } = pkg;

const app = express();
app.use(express.json());

let qrCodeData = null;
let clientReady = false;

// --- CLIENTE WHATSAPP ---
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
        ],
    },
});

// LOGS
client.on("qr", (qr) => {
    console.log("QR recibido, escanea para iniciar sesión.");
    qrcode.toDataURL(qr, (err, url) => {
        qrCodeData = url;
    });
});

client.on("ready", () => {
    clientReady = true;
    qrCodeData = null;
    console.log("WhatsApp listo!");
});

client.on("authenticated", () => {
    console.log("Autenticado correctamente.");
});

client.on("auth_failure", () => {
    console.log("❌ Falla de autenticación.");
});

client.on("disconnected", (reason) => {
    console.log("❌ Cliente desconectado:", reason);
    clientReady = false;
});

client.initialize();

// --- API ENDPOINTS ---

// GET QR COMO PNG
app.get("/qr.png", (req, res) => {
    if (!qrCodeData) {
        return res.status(503).send("QR no disponible aún.");
    }

    const img = Buffer.from(qrCodeData.split(",")[1], "base64");
    res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": img.length,
    });
    res.end(img);
});

// ESTADO DEL SERVICIO
app.get("/status", (req, res) => {
    res.json({
        whatsapp: clientReady ? "ready" : "pending",
        qr_available: qrCodeData ? true : false,
    });
});

// ENVIAR MENSAJE
app.post("/send", async (req, res) => {
    try {
        if (!clientReady) {
            return res.status(400).json({ error: "WhatsApp no está listo todavía." });
        }

        const { to, message } = req.body;

        if (!to || !message) {
            return res.status(400).json({ error: "Faltan parámetros: to, message" });
        }

        const chatId = to.includes("@c.us") ? to : `${to}@c.us`;

        await client.sendMessage(chatId, message);

        console.log(`Mensaje enviado a ${chatId}: ${message}`);

        res.json({ status: "sent", to: chatId });
    } catch (err) {
        console.error("Error enviando mensaje:", err);
        res.status(500).json({ error: "Error enviando mensaje." });
    }
});

// API EN PUERTO (configurable con PORT)
const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
    console.log("API lista en puerto " + PORT);
});
