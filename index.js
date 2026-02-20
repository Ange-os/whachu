import express from "express";
import pkg from "whatsapp-web.js";
import qrcodeTerminal from "qrcode-terminal";

const { Client, LocalAuth } = pkg;

const app = express();
app.use(express.json());

let clientReady = false;
let isReinitializing = false;
let reinitTimeoutId = null;
const REINIT_DELAY_MS = 18000;        // 18 s para que el navegador cierre bien
const REINIT_DELAY_AFTER_FAIL_MS = 45000; // 45 s si el último reintento falló

// --- CLIENTE WHATSAPP ---
// En VPS la carga puede ser lenta: más tiempo para que cargue la página y aparezca el QR
const AUTH_TIMEOUT_MS = 120000; // 2 minutos

const client = new Client({
    authStrategy: new LocalAuth(),
    authTimeoutMs: AUTH_TIMEOUT_MS,
    puppeteer: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-software-rasterizer",
            "--no-zygote",
            "--disable-extensions",
        ],
    },
});

let lastReinitFailed = false;

function scheduleReinit() {
    if (isReinitializing) return;
    isReinitializing = true;
    clientReady = false;
    const delay = lastReinitFailed ? REINIT_DELAY_AFTER_FAIL_MS : REINIT_DELAY_MS;
    console.log("⏳ Reintentando inicializar cliente en", delay / 1000, "segundos...");
    if (reinitTimeoutId) clearTimeout(reinitTimeoutId);
    reinitTimeoutId = setTimeout(async () => {
        reinitTimeoutId = null;
        try {
            try {
                await Promise.race([
                    client.destroy(),
                    new Promise((_, rej) => setTimeout(() => rej(new Error("destroy timeout")), 10000)),
                ]);
            } catch (_) {}
            await client.initialize();
            lastReinitFailed = false;
        } catch (err) {
            lastReinitFailed = true;
            const errMsg = err != null ? (err?.message ?? String(err)) : "error desconocido";
            console.error("Error al reinicializar:", errMsg);
        } finally {
            isReinitializing = false;
        }
    }, delay);
}

// Errores de Puppeteer/whatsapp-web.js que no deben tumbar el proceso
process.on("uncaughtException", (err) => {
    const msg = err?.message || String(err);
    if (
        msg.includes("Execution context was destroyed") ||
        msg.includes("Protocol error (Network.getResponseBody)") ||
        msg.includes("ProtocolError")
    ) {
        console.error("⚠️ Error interno de Puppeteer/WhatsApp (se reintentará):", msg.slice(0, 120));
        scheduleReinit();
        return;
    }
    console.error("Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
    const msg = reason?.message || String(reason);
    if (
        msg.includes("Execution context was destroyed") ||
        msg.includes("Protocol error (Network.getResponseBody)") ||
        msg.includes("ProtocolError")
    ) {
        console.error("⚠️ Rechazo no manejado de Puppeteer/WhatsApp (se reintentará):", msg.slice(0, 120));
        scheduleReinit();
        return;
    }
    if (msg.includes("auth timeout")) {
        console.error("⚠️ Timeout de autenticación (la página tardó en cargar). Reintentando en", REINIT_DELAY_MS / 1000, "s...");
        scheduleReinit();
        return;
    }
    console.error("Unhandled rejection:", reason);
});

// EVENTOS DEL CLIENTE
client.on("qr", (qr) => {
    console.log("QR recibido, escanea para iniciar sesión:");
    qrcodeTerminal.generate(qr, { small: true });
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
    scheduleReinit();
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

        // Validar que el número esté registrado
        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) {
            return res.status(400).json({ error: "Número no registrado en WhatsApp" });
        }

        // Enviar mensaje sin marcar como leído
        await client.sendMessage(chatId, message, { sendSeen: false });

        console.log(`Mensaje enviado a ${chatId}: ${message}`);
        res.json({ status: "sent", to: chatId });
    } catch (err) {
        console.error("Error enviando mensaje:", err);
        try {
            console.log("Estado actual:", await client.getState());
        } catch (stateErr) {
            console.error("No se pudo obtener el estado del cliente:", stateErr);
        }
        res.status(500).json({ error: "Error enviando mensaje." });
    }
});

// API EN PUERTO 3000
const PORT = 3000;
app.listen(PORT, () => {
    console.log("API lista en puerto " + PORT);
});