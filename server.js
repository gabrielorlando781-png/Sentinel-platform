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
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Validação crítica de startup: Garantir que as credenciais obrigatórias existem
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.JWT_SECRET) {
    console.error('--- ERRO CRÍTICO: Variáveis de ambiente obrigatórias ausentes! ---');
    console.error('Verifique seu arquivo .env e configure SUPABASE_URL, SUPABASE_SERVICE_KEY e JWT_SECRET.');
    process.exit(1);
}

// ─── Supabase (service role — bypasses RLS) ───────────────────────────────────
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// Garantir que o bucket de screenshots exista
async function ensureBucket() {
    try {
        const { data: buckets, error } = await supabase.storage.listBuckets();
        if (error) throw error;
        
        const exists = buckets?.find(b => b.name === 'screenshots');
        if (!exists) {
            console.log('--- AVISO: Bucket "screenshots" não encontrado. Tentando criar... ---');
            const { error: createError } = await supabase.storage.createBucket('screenshots', {
                public: true
            });
            if (createError) {
                console.error('--- ERRO CRÍTICO: Não foi possível criar o bucket "screenshots". Crie manualmente no painel do Supabase! ---');
                console.error('Erro:', createError.message);
            } else {
                console.log('--- SUCESSO: Bucket "screenshots" criado com sucesso! ---');
            }
        } else {
            console.log('--- Bucket "screenshots" verificado e pronto! ---');
        }
    } catch (err) {
        console.error('Erro ao verificar armazenamento:', err.message);
    }
}
ensureBucket();



// ─── Middleware e Proteções de Segurança ───────────────────────────────────────
// Adiciona cabeçalhos HTTP robustos contra ataques.
// O Content-Security-Policy é desativado para garantir compatibilidade total com
// os carregamentos de scripts CDN do Google MediaPipe, TensorFlow e fontes no frontend.
app.use(helmet({
    contentSecurityPolicy: false
}));

app.use(cors());
app.use(bodyParser.json({ limit: '2mb' })); // Limite de payload seguro para capturas de webcam

// Desabilita cache estrito para arquivos HTML para evitar que o navegador armazene cache
// local das páginas do dashboard e login (evitando redirecionamentos infinitos pós-logout)
app.use((req, res, next) => {
    const isHtml = req.path.endsWith('.html') || req.path === '/' || req.path === '/dashboard';
    if (isHtml) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Rate Limiters (Prevenção de Abuso e Brute-Force) ─────────────────────────
// Limite para a API em geral (previne sobrecarga e ataques de DDoS volumétricos)
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 500, // Limite de 500 requisições por IP
    message: { error: 'Limite de requisições excedido. Tente novamente em breve.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Limite rígido para rotas de autenticação (cadastro/login) impedindo brute-force
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 30, // Limite de 30 tentativas por IP
    message: { error: 'Muitas tentativas de autenticação deste IP. Tente novamente em 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Limite para envio de novos alertas (impede inundação maliciosa de falsos positivos)
const alertLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 100, // Limite seguro para o detector enviar imagens (1.6 alertas/segundo)
    message: { error: 'Frequência de envio de alertas muito alta. Aguarde um instante.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Aplicar os limites nas rotas correspondentes
app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);
app.use('/api/alert', alertLimiter);

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
async function sendTelegram(alert, userId) {
    if (!process.env.TELEGRAM_BOT_TOKEN) return;
    
    // Fetch user settings from DB
    const { data: user, error } = await supabase
        .from('users')
        .select('telegram_chat_id, telegram_active, telegram_filters')
        .eq('id', userId)
        .single();

    if (error || !user || !user.telegram_active || !user.telegram_chat_id) {
        console.log(`Telegram skipping for user ${userId}: Active=${user?.telegram_active}, ID=${user?.telegram_chat_id}`);
        return;
    }
    
    // Check filter preferences
    if (user.telegram_filters && user.telegram_filters !== 'ALL') {
        const allowedTypes = user.telegram_filters.split(',').map(s => s.trim().toUpperCase());
        const alertTypeUpperCase = (alert.type || '').toUpperCase();
        // Check if any of the allowed substrings matches the alert type
        const isAllowed = allowedTypes.some(t => alertTypeUpperCase.includes(t));
        if (!isAllowed) {
            console.log(`Telegram skipping for user ${userId}: Alert type '${alert.type}' not in filters '${user.telegram_filters}'`);
            return;
        }
    }
    
    const caption = `🚨 *SENTINEL - ALERTA ATIVO*\n\n` +
                    `*Tipo:* ${alert.type}\n` +
                    `*Severidade:* ${alert.severity.toUpperCase()}\n` +
                    `*Data/Hora:* ${new Date(alert.created_at).toLocaleString('pt-BR')}\n` +
                    `*Confiança:* ${alert.confidence}%\n` +
                    `${alert.description ? `*Descrição:* ${alert.description}` : ''}`;

    const encodedCaption = encodeURIComponent(caption);
    let url;

    if (alert.screenshot_url) {
        url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendPhoto?chat_id=${user.telegram_chat_id}&photo=${encodeURIComponent(alert.screenshot_url)}&caption=${encodedCaption}&parse_mode=Markdown`;
    } else {
        url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage?chat_id=${user.telegram_chat_id}&text=${encodedCaption}&parse_mode=Markdown`;
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

// ─── Health / Ping Route (Keep Awake) ──────────────────────────────────────────
app.get('/ping', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Sentinel is awake!', timestamp: new Date() });
});

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
        console.error('Register error details:', JSON.stringify(err, null, 2));
        console.error('Register error stack:', err);
        return res.status(500).json({ error: `Erro ao registrar: ${err.message || 'Erro interno'}` });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'email e password são obrigatórios.' });

        const { data: user, error } = await supabase
            .from('users')
            .select('id, email, role, name, password_hash, telegram_chat_id, telegram_active, detection_timer, telegram_filters')
            .eq('email', email.toLowerCase())
            .maybeSingle();

        if (error || !user) return res.status(401).json({ error: 'Credenciais inválidas.' });

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Credenciais inválidas.' });

        const token = signToken({ id: user.id, email: user.email, role: user.role, name: user.name });
        return res.json({ 
            token, 
            user: { 
                id: user.id, 
                email: user.email, 
                role: user.role, 
                name: user.name,
                telegram_chat_id: user.telegram_chat_id,
                telegram_active: user.telegram_active,
                detection_timer: user.detection_timer,
                telegram_filters: user.telegram_filters
            } 
        });
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ error: 'Erro ao realizar login.' });
    }
});

// ─── Settings Routes ───────────────────────────────────────────────────────────
app.put('/api/user/settings', authenticateToken, async (req, res) => {
    try {
        const { telegram_chat_id, telegram_active, detection_timer, telegram_filters } = req.body;
        
        const { data, error } = await supabase
            .from('users')
            .update({ 
                telegram_chat_id, 
                telegram_active: !!telegram_active,
                detection_timer: detection_timer || 5,
                telegram_filters: telegram_filters || 'ALL'
            })
            .eq('id', req.user.id)
            .select()
            .single();

        if (error) throw error;

        return res.json({ message: 'Configurações atualizadas com sucesso.', user: data });
    } catch (err) {
        console.error('Update settings error:', err);
        return res.status(500).json({ error: 'Erro ao atualizar configurações.' });
    }
});

// ─── /api/me ───────────────────────────────────────────────────────────────────
app.get('/api/me', authenticateToken, async (req, res) => {
    const { data: user, error } = await supabase
        .from('users')
        .select('id, email, role, name, telegram_chat_id, telegram_active, detection_timer, telegram_filters')
        .eq('id', req.user.id)
        .single();
    
    if (error || !user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    return res.json(user);
});

// ─── GET /api/telegram/bot_link ────────────────────────────────────────────────
app.get('/api/telegram/bot_link', authenticateToken, (req, res) => {
    if (!tgBotUsername) return res.status(500).json({ error: 'Bot não inicializado ou token inválido.' });
    return res.json({ link: `https://t.me/${tgBotUsername}?start=${req.user.id}` });
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

        // 1. Upload to Supabase Storage (Opcional - não trava o processo)
        let publicUrl = null;
        try {
            const { error: uploadError } = await supabase.storage
                .from('screenshots')
                .upload(filename, buffer, { contentType: 'image/jpeg', upsert: false });

            if (!uploadError) {
                const { data: urlData } = supabase.storage
                    .from('screenshots')
                    .getPublicUrl(filename);
                publicUrl = urlData?.publicUrl;
            } else {
                console.warn('Aviso: Foto não salva (Bucket não encontrado ou erro de permissão).');
            }
        } catch (storageErr) {
            console.error('Erro de Storage (Foto ignorada):', storageErr.message);
        }

        // 2. Insert alert into DB
        // Criamos o objeto básico primeiro
        const alertData = {
            id: alertId,
            user_id: userId,
            type,
            severity,
            confidence,
            description,
            screenshot_url: publicUrl
        };

        // Adicionamos resolved e modules apenas como garantia, 
        // mas o SQL acima deve resolver a estrutura.
        alertData.resolved = false;
        alertData.modules = modules || [];

        let { data: alert, error: dbError } = await supabase
            .from('alerts')
            .insert(alertData)
            .select()
            .single();

        // MODO DE COMPATIBILIDADE: Se o schema estiver desatualizado, tenta salvar sem as colunas extras
        if (dbError && dbError.code === 'PGRST204') {
            console.warn('--- AVISO: Banco de dados desatualizado. Entrando em modo de compatibilidade... ---');
            const fallbackData = {
                id: alertId,
                user_id: userId,
                type: alertData.type,
                severity: alertData.severity,
                confidence: alertData.confidence,
                description: alertData.description
            };
            
            const retry = await supabase
                .from('alerts')
                .insert(fallbackData)
                .select()
                .single();
            
            alert = retry.data;
            dbError = retry.error;
        }

        if (dbError) {
            console.error('DATABASE ERROR:', dbError);
            throw dbError;
        }



        // Notifications
        sendTelegram(alert, userId);
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
        if (from) {
            const fromDate = new Date(`${from}T00:00:00`);
            query = query.gte('created_at', fromDate.toISOString());
        }
        if (to) {
            const toDate = new Date(`${to}T23:59:59.999`);
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

        const fromDate = new Date(`${from}T00:00:00`);
        const toDate = new Date(`${to}T23:59:59`);

        let query = supabase
            .from('alerts')
            .select('*')
            .gte('created_at', fromDate.toISOString())
            .lte('created_at', toDate.toISOString());

        if (req.user.role !== 'admin') {
            query = query.eq('user_id', req.user.id);
        }

        query = query.order('created_at', { ascending: false });

        const { data: alerts, error } = await query;
        if (error) throw error;

        // Gerar conteúdo CSV
        const header = 'Data,Hora,Tipo,Severidade,Confiança,Descrição\n';
        const rows = alerts.map(a => {
            const dateObj = new Date(a.created_at);
            const dataStr = dateObj.toLocaleDateString('pt-BR');
            const horaStr = dateObj.toLocaleTimeString('pt-BR');
            const desc = (a.description || '').replace(/"/g, '""'); // Escape double quotes
            return `"${dataStr}","${horaStr}","${a.type}","${a.severity}","${a.confidence}%","${desc}"`;
        });
        
        const csvContent = header + rows.join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="relatorio_${from}_a_${to}.csv"`);
        
        return res.send(Buffer.from('\uFEFF' + csvContent, 'utf-8')); // \uFEFF is BOM for Excel UTF-8 support
    } catch (err) {
        console.error('Export error:', err);
        return res.status(500).json({ error: 'Erro ao exportar relatório.' });
    }
});

// ─── POST /api/alerts/bulk-delete ──────────────────────────────────────────────
app.post('/api/alerts/bulk-delete', authenticateToken, async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'Lista de IDs inválida.' });
        }

        let query = supabase.from('alerts').delete().in('id', ids);

        if (req.user.role !== 'admin') {
            query = query.eq('user_id', req.user.id);
        }

        const { error } = await query;
        if (error) throw error;

        return res.json({ message: `${ids.length} alerta(s) excluído(s) com sucesso.` });
    } catch (err) {
        console.error('Bulk delete error:', err);
        return res.status(500).json({ error: 'Erro ao remover alertas.' });
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
startTelegramPolling();

app.listen(PORT, () => {
    console.log(`SENTINEL Server running at http://localhost:${PORT}`);
    
    // Auto-ping de auto-preservação (para não desligar no Render)
    const renderUrl = process.env.RENDER_EXTERNAL_URL;
    if (renderUrl) {
        console.log(`[Keep Awake] Auto-ping configurado para ${renderUrl}/ping a cada 10 minutos.`);
        setInterval(() => {
            https.get(`${renderUrl}/ping`, (res) => {
                console.log(`[Keep Awake] Auto-ping status: ${res.statusCode}`);
            }).on('error', (err) => {
                console.error('[Keep Awake] Erro no auto-ping:', err.message);
            });
        }, 10 * 60 * 1000); // 10 minutos
    } else {
        console.log('[Keep Awake] RENDER_EXTERNAL_URL não encontrada. Para ativar o auto-ping local, configure essa variável.');
    }
});

// ─── Telegram Bot Polling ──────────────────────────────────────────────────────
let tgBotUsername = null;
let lastUpdateId = 0;

async function startTelegramPolling() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;

    https.get(`https://api.telegram.org/bot${token}/getMe`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                const response = JSON.parse(data);
                if (response.ok && response.result.username) {
                    tgBotUsername = response.result.username;
                    console.log(`[Telegram] Bot iniciado como @${tgBotUsername}`);
                    pollTelegram();
                }
            } catch(e) {}
        });
    }).on('error', () => {});
}

function pollTelegram() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    
    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
    https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', async () => {
            try {
                const response = JSON.parse(data);
                if (response.ok && response.result && response.result.length > 0) {
                    for (const update of response.result) {
                        lastUpdateId = update.update_id;
                        if (update.message && update.message.text) {
                            const text = update.message.text;
                            const chatId = update.message.chat.id;
                            
                            console.log(`[Telegram] Mensagem recebida de ${chatId}: ${text}`);
                            
                            if (text.startsWith('/start ')) {
                                const userId = text.split(' ')[1];
                                
                                const { error } = await supabase.from('users').update({ 
                                    telegram_chat_id: String(chatId), 
                                    telegram_active: true 
                                }).eq('id', userId);

                                if (!error) {
                                    const msg = encodeURIComponent(`✅ *Sucesso!* Seu Telegram foi vinculado à sua conta do SENTINEL.\n\nVocê receberá alertas de segurança diretamente aqui.`);
                                    https.get(`https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}&text=${msg}&parse_mode=Markdown`);
                                    console.log(`[Telegram] Usuário ${userId} vinculado ao chat ${chatId}`);
                                } else {
                                    console.error('[Telegram] Erro ao vincular:', error);
                                }
                            } else if (text === '/start') {
                                const msg = encodeURIComponent(`⚠️ Para vincular seu Telegram, por favor, vá até o **Dashboard** da plataforma SENTINEL, abra as Configurações e clique no botão "Vincular Telegram".`);
                                https.get(`https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}&text=${msg}&parse_mode=Markdown`);
                            }
                        }
                    }
                }
            } catch(e) {
                console.error('[Telegram Polling] Parse Error:', e.message);
            }
            // CONTINUE POLLING (with a small delay to prevent tight loops on API errors)
            setTimeout(pollTelegram, 1000);
        });
    }).on('error', (err) => {
        console.error('[Telegram Polling] Network Error:', err.message);
        setTimeout(pollTelegram, 5000);
    });
}
