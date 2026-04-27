const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const https = require('https');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Supabase (service role — bypasses RLS) ───────────────────────────────────
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── JWT Helpers ───────────────────────────────────────────────────────────────
function signToken(payload) {
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token ausente.' });
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }
}

function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito a administradores.' });
    next();
}

// ─── Notification Helpers ──────────────────────────────────────────────────────
function sendTelegram(alert) {
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
    
    const caption = `🚨 *SENTINEL - ALERTA ATIVO*\n\n` +
                    `*Tipo:* ${alert.type}\n` +
                    `*Severidade:* ${alert.severity.toUpperCase()}\n` +
                    `*Data/Hora:* ${new Date(alert.created_at).toLocaleString('pt-BR')}\n` +
                    `*Confiança:* ${alert.confidence}%\n` +
                    `${alert.description ? `*Descrição:* ${alert.description}` : ''}`;

    const encodedCaption = encodeURIComponent(caption);
    let url;

    if (alert.screenshot_url) {
        url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendPhoto?chat_id=${process.env.TELEGRAM_CHAT_ID}&photo=${encodeURIComponent(alert.screenshot_url)}&caption=${encodedCaption}&parse_mode=Markdown`;
    } else {
        url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage?chat_id=${process.env.TELEGRAM_CHAT_ID}&text=${encodedCaption}&parse_mode=Markdown`;
    }

    https.get(url).on('error', (e) => console.error('Telegram Error:', e));
}

function sendEmail(alert) {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || !process.env.ALERT_EMAIL_TO) return;
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: process.env.ALERT_EMAIL_TO,
        subject: `[SENTINEL] Alerta: ${alert.type}`,
        text: `Alerta detectado: ${alert.type} (${alert.severity}) em ${new Date(alert.created_at).toLocaleString('pt-BR')}\n\nDescrição: ${alert.description || 'N/A'}\nConfiança: ${alert.confidence}%`
    };
    transporter.sendMail(mailOptions, (error) => {
        if (error) console.error('Email Error:', error);
    });
}

function sendWebhook(alert) {
    if (!process.env.WEBHOOK_URL) return;
    const data = JSON.stringify(alert);
    const url = new URL(process.env.WEBHOOK_URL);
    const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + (url.search || ''),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options);
    req.on('error', (e) => console.error('Webhook Error:', e));
    req.write(data);
    req.end();
}

// ─── Auth Routes ───────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) return res.status(400).json({ error: 'name, email e password são obrigatórios.' });

        // Check duplicate
        const { data: existing } = await supabase
            .from('users')
            .select('id')
            .eq('email', email.toLowerCase())
            .maybeSingle();

        if (existing) return res.status(409).json({ error: 'E-mail já cadastrado.' });

        const password_hash = await bcrypt.hash(password, 12);

        const { data: user, error } = await supabase
            .from('users')
            .insert({ name, email: email.toLowerCase(), password_hash, role: 'user' })
            .select('id, email, role, name')
            .single();

        if (error) throw error;

        const token = signToken({ id: user.id, email: user.email, role: user.role, name: user.name });
        return res.status(201).json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } });
    } catch (err) {
        console.error('Register error:', err);
        return res.status(500).json({ error: 'Erro ao registrar usuário.' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'email e password são obrigatórios.' });

        const { data: user, error } = await supabase
            .from('users')
            .select('id, email, role, name, password_hash')
            .eq('email', email.toLowerCase())
            .maybeSingle();

        if (error || !user) return res.status(401).json({ error: 'Credenciais inválidas.' });

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Credenciais inválidas.' });

        const token = signToken({ id: user.id, email: user.email, role: user.role, name: user.name });
        return res.json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } });
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ error: 'Erro ao realizar login.' });
    }
});

// ─── /api/me ───────────────────────────────────────────────────────────────────
app.get('/api/me', authenticateToken, async (req, res) => {
    return res.json({ id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role });
});

// ─── POST /api/alert ───────────────────────────────────────────────────────────
app.post('/api/alert', authenticateToken, async (req, res) => {
    try {
        const { type, severity = 'medium', confidence = 90, description = '', screenshot, modules } = req.body;
        if (!type || !screenshot) return res.status(400).json({ error: 'type e screenshot são obrigatórios.' });

        const userId = req.user.id;
        const alertId = uuidv4();
        const now = new Date();
        const dateFolder = now.toISOString().split('T')[0];
        const filename = `${userId}/${dateFolder}/alert_${alertId}.jpg`;

        // Decode base64 and upload to Supabase Storage
        const base64Data = screenshot.replace(/^data:image\/jpeg;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        const { error: uploadError } = await supabase.storage
            .from('screenshots')
            .upload(filename, buffer, { contentType: 'image/jpeg', upsert: false });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
            .from('screenshots')
            .getPublicUrl(filename);

        // Insert alert into DB
        const { data: alert, error: dbError } = await supabase
            .from('alerts')
            .insert({
                id: alertId,
                user_id: userId,
                type,
                severity,
                confidence,
                description,
                modules: modules || [],
                screenshot_url: publicUrl,
                resolved: false
            })
            .select()
            .single();

        if (dbError) throw dbError;

        // Notifications
        sendTelegram(alert);
        sendEmail(alert);
        sendWebhook(alert);

        return res.status(201).json(alert);
    } catch (err) {
        console.error('Alert error:', err);
        return res.status(500).json({ error: 'Erro ao processar alerta.' });
    }
});

// ─── GET /api/alerts ───────────────────────────────────────────────────────────
app.get('/api/alerts', authenticateToken, async (req, res) => {
    try {
        const { type, severity, from, to, limit = 50, offset = 0 } = req.query;

        let query;

        if (req.user.role === 'admin') {
            query = supabase
                .from('alerts')
                .select('*, users(name, email)', { count: 'exact' });
        } else {
            query = supabase
                .from('alerts')
                .select('*', { count: 'exact' })
                .eq('user_id', req.user.id);
        }

        if (type && type !== 'all') query = query.ilike('type', `%${type}%`);
        if (severity && severity !== 'all') query = query.eq('severity', severity);
        if (from) query = query.gte('created_at', new Date(from).toISOString());
        if (to) {
            const toDate = new Date(to);
            toDate.setHours(23, 59, 59, 999);
            query = query.lte('created_at', toDate.toISOString());
        }

        query = query
            .order('created_at', { ascending: false })
            .range(Number(offset), Number(offset) + Number(limit) - 1);

        const { data, error, count } = await query;
        if (error) throw error;

        return res.json({ alerts: data, total: count });
    } catch (err) {
        console.error('Get alerts error:', err);
        return res.status(500).json({ error: 'Erro ao buscar alertas.' });
    }
});

// ─── GET /api/alerts/:id/screenshot ───────────────────────────────────────────
app.get('/api/alerts/:id/screenshot', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { data: alert, error } = await supabase
            .from('alerts')
            .select('user_id, screenshot_url')
            .eq('id', id)
            .single();

        if (error || !alert) return res.status(404).json({ error: 'Alerta não encontrado.' });
        if (req.user.role !== 'admin' && alert.user_id !== req.user.id) {
            return res.status(403).json({ error: 'Acesso negado.' });
        }

        return res.redirect(302, alert.screenshot_url);
    } catch (err) {
        console.error('Screenshot redirect error:', err);
        return res.status(500).json({ error: 'Erro ao redirecionar para screenshot.' });
    }
});

// ─── POST /api/reports/export ─────────────────────────────────────────────────
app.post('/api/reports/export', authenticateToken, async (req, res) => {
    try {
        const { from, to } = req.body;
        if (!from || !to) return res.status(400).json({ error: 'from e to são obrigatórios.' });

        let query = supabase
            .from('alerts')
            .select('*')
            .gte('created_at', new Date(from).toISOString());

        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        query = query.lte('created_at', toDate.toISOString());

        if (req.user.role !== 'admin') {
            query = query.eq('user_id', req.user.id);
        }

        query = query.order('created_at', { ascending: false });

        const { data: alerts, error } = await query;
        if (error) throw error;

        const lines = alerts.map(a =>
            `[${new Date(a.created_at).toLocaleString('pt-BR')}] TIPO: ${a.type} | SEVERIDADE: ${a.severity} | CONFIANÇA: ${a.confidence}% | DESC: ${a.description || 'N/A'}`
        );
        const header = `RELATÓRIO SENTINEL\nPeríodo: ${from} a ${to}\nGerado em: ${new Date().toLocaleString('pt-BR')}\nTotal de alertas: ${alerts.length}\n${'─'.repeat(80)}\n`;
        const content = header + lines.join('\n');

        const reportId = uuidv4();
        const filename = `${req.user.id}/report_${reportId}.txt`;
        const buffer = Buffer.from(content, 'utf-8');

        const { error: uploadError } = await supabase.storage
            .from('reports')
            .upload(filename, buffer, { contentType: 'text/plain', upsert: false });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
            .from('reports')
            .getPublicUrl(filename);

        const { error: dbError } = await supabase
            .from('reports')
            .insert({
                id: reportId,
                user_id: req.user.id,
                from_date: from,
                to_date: to,
                file_url: publicUrl,
                alert_count: alerts.length
            });

        if (dbError) throw dbError;

        return res.json({ file_url: publicUrl });
    } catch (err) {
        console.error('Export error:', err);
        return res.status(500).json({ error: 'Erro ao exportar relatório.' });
    }
});

// ─── DELETE /api/alerts/:id ───────────────────────────────────────────────────
app.delete('/api/alerts/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Check if user has permission
        const { data: alert, error: fetchError } = await supabase
            .from('alerts')
            .select('user_id')
            .eq('id', id)
            .single();

        if (fetchError || !alert) return res.status(404).json({ error: 'Alerta não encontrado.' });
        
        if (req.user.role !== 'admin' && alert.user_id !== req.user.id) {
            return res.status(403).json({ error: 'Permissão negada para excluir este alerta.' });
        }

        const { error: deleteError } = await supabase
            .from('alerts')
            .delete()
            .eq('id', id);

        if (deleteError) throw deleteError;

        return res.json({ message: 'Alerta removido com sucesso.' });
    } catch (err) {
        console.error('Delete alert error:', err);
        return res.status(500).json({ error: 'Erro ao remover alerta.' });
    }
});

// ─── Static pages ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ─── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`SENTINEL Server running at http://localhost:${PORT}`);
});
