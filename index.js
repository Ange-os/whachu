import express from "express";
import pkg from "whatsapp-web.js";
import qrcodeTerminal from "qrcode-terminal";

const { Client, LocalAuth } = pkg;

const app = express();
app.use(express.json());

let clientReady = false;

const client = new Client({
    authStrategy: new LocalAuth(),
    authTimeoutMs: 900000,
    puppeteer: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-software-rasterizer",
            "--disable-extensions",
            "--no-first-run",
            "--disable-background-networking",
            "--disable-sync",
            "--disable-default-apps",
            "--mute-audio",
            "--no-default-browser-check",
        ],
    },
});

client.on("qr", (qr) => {
    console.log("Escanea el QR con WhatsApp (Enlazar dispositivo):");
    qrcodeTerminal.generate(qr, { small: true });
});

client.on("ready", () => {
    clientReady = true;
    console.log("WhatsApp listo.");
});

client.on("authenticated", () => {
    console.log("Autenticado.");
});

client.on("auth_failure", () => {
    console.log("Falla de autenticación.");
});

client.on("disconnected", (reason) => {
    clientReady = false;
    console.log("Desconectado:", reason);
});

let reconectando = false;
function reintentar() {
    if (reconectando) return;
    reconectando = true;
    const seg = 30;
    console.log("Reintentando en", seg, "s...");
    setTimeout(async () => {
        try {
            await client.destroy().catch(() => {});
            await new Promise((r) => setTimeout(r, 5000));
            await client.initialize();
        } catch (e) {
            console.error("Reintento falló:", e?.message || e);
        } finally {
            reconectando = false;
        }
    }, seg * 1000);
}

function esErrorReintentable(msg) {
    return (
        msg.includes("auth timeout") ||
        msg.includes("Protocol error (Network.getResponseBody)") ||
        msg.includes("No data found for resource") ||
        msg.includes("Execution context was destroyed") ||
        msg.includes("detached Frame")
    );
}

process.on("unhandledRejection", (reason) => {
    const msg = reason?.message ?? String(reason);
    console.error("Error no capturado:", msg.slice(0, 100));
    if (esErrorReintentable(msg)) {
        console.log("Se reintentará en 15 s...");
        reintentar();
    }
});

console.log("Conectando a WhatsApp Web, espera el QR (puede tardar 1-2 min)...");
client.initialize().catch((err) => {
    const msg = String(err?.message || err);
    console.error("Error al iniciar WhatsApp:", msg.slice(0, 100));
    if (esErrorReintentable(msg)) reintentar();
});

app.post("/send", async (req, res) => {
    try {
        if (!clientReady) {
            return res.status(400).json({ error: "WhatsApp no está listo." });
        }
        const { to, message } = req.body;
        if (!to || !message) {
            return res.status(400).json({ error: "Faltan: to, message" });
        }
        const chatId = to.includes("@c.us") ? to : `${to}@c.us`;
        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) {
            return res.status(400).json({ error: "Número no registrado en WhatsApp" });
        }
        await client.sendMessage(chatId, message, { sendSeen: false });
        console.log("Enviado a", chatId);
        res.json({ status: "sent", to: chatId });
    } catch (err) {
        console.error("Error enviando:", err?.message || err);
        res.status(500).json({ error: "Error enviando mensaje." });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log("API en puerto", PORT);
});
