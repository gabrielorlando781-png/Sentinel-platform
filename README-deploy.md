# SENTINEL — Guia de Deploy no Railway

## Pré-requisitos
- Conta no [Railway](https://railway.app)
- Conta no [Supabase](https://supabase.com) com as tabelas `users`, `alerts` e `reports` criadas
- Repositório no GitHub com os arquivos do projeto

---

## Passo 1 — Preparar o repositório GitHub

1. Crie um novo repositório no GitHub (público ou privado).
2. Faça upload de todos os arquivos do projeto, **exceto**:
   - `node_modules/`
   - `.env` (nunca comitar variáveis secretas)
   - `screenshots/`
   - `alerts.json`
3. Certifique-se de que o `.gitignore` contém:
   ```
   node_modules/
   .env
   screenshots/
   alerts.json
   ```

---

## Passo 2 — Criar o projeto no Railway

1. Acesse [railway.app](https://railway.app) e faça login.
2. Clique em **New Project**.
3. Selecione **Deploy from GitHub repo**.
4. Autorize o Railway e selecione o repositório do SENTINEL.
5. O Railway detectará automaticamente que é um projeto Node.js.

---

## Passo 3 — Configurar variáveis de ambiente

Na aba **Variables** do seu serviço Railway, adicione as seguintes variáveis:

| Variável | Valor |
|---|---|
| `PORT` | `3000` |
| `SUPABASE_URL` | `https://yzvdfilgqboiouwyhbde.supabase.co` |
| `SUPABASE_ANON_KEY` | *(valor do .env)* |
| `SUPABASE_SERVICE_KEY` | *(valor do .env)* |
| `JWT_SECRET` | `sentinel-jwt-secret-32chars-xK9mP2` |
| `NODE_ENV` | `production` |
| `TELEGRAM_BOT_TOKEN` | *(opcional)* |
| `TELEGRAM_CHAT_ID` | *(opcional)* |
| `EMAIL_USER` | *(opcional)* |
| `EMAIL_PASS` | *(opcional)* |
| `ALERT_EMAIL_TO` | *(opcional)* |
| `WEBHOOK_URL` | *(opcional)* |

---

## Passo 4 — Criar tabelas no Supabase (se ainda não existirem)

Acesse o **SQL Editor** do Supabase e execute:

```sql
-- Tabela de usuários
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de alertas
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium',
    confidence INTEGER DEFAULT 90,
    description TEXT DEFAULT '',
    modules TEXT[] DEFAULT '{}',
    screenshot_url TEXT,
    resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de relatórios
CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    file_url TEXT NOT NULL,
    alert_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Passo 5 — Criar buckets no Supabase Storage

No painel do Supabase, vá em **Storage** e crie dois buckets:

1. **`screenshots`** — marcar como **Public**
2. **`reports`** — marcar como **Public**

---

## Passo 6 — Promover primeiro usuário a admin

Após o deploy e o primeiro cadastro, acesse o **SQL Editor** do Supabase e execute:

```sql
UPDATE users SET role = 'admin' WHERE email = 'seu@email.com';
```

Substitua `seu@email.com` pelo e-mail que você usou no cadastro.

---

## Passo 7 — Acessar o sistema

Após o deploy, o Railway fornecerá uma URL pública no formato:

```
https://sentinel-xxxx.up.railway.app
```

- **Interface de monitoramento**: `https://sentinel-xxxx.up.railway.app/`
- **Dashboard de alertas**: `https://sentinel-xxxx.up.railway.app/dashboard`

---

## Solução de Problemas

- **Deploy falha**: Verifique se o `package.json` tem o script `"start": "node server.js"`.
- **Erro de conexão com Supabase**: Confirme que o `SUPABASE_SERVICE_KEY` foi copiado corretamente na aba Variables.
- **Câmera não abre**: O site precisa ser acessado via HTTPS (o Railway fornece isso automaticamente). Em `localhost`, use `http://localhost:3000`.
- **Upload de screenshot falha**: Certifique-se de que os buckets `screenshots` e `reports` foram criados no Supabase Storage e estão marcados como **Public**.

---

**SENTINEL v2.0 — Segurança e Eficiência Potencializadas por IA**
