import express from "express";
import pkg from "whatsapp-web.js";
import qrcodeTerminal from "qrcode-terminal";

const { Client, LocalAuth } = pkg;

const app = express();
app.use(express.json());

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

// EVENTOS DEL CLIENTE
client.on("qr", (qr) => {
    console.log("QR recibido, escanea para iniciar sesión:");
    qrcodeTerminal.generate(qr, { small: true }); // muestra el QR en consola
});

client.on("ready", () => {
    clientReady = true;
    console.log("✅ WhatsApp listo!");
});

client.on("authenticated", () => {
    console.log("🔑 Autenticado correctamente.");
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

// API EN PUERTO 3000
const PORT = 3000;
app.listen(PORT, () => {
    console.log("API lista en puerto " + PORT);
});