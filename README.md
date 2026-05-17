# SENTINEL — Monitor Inteligente de Colaboradores

SENTINEL é um sistema de monitoramento de trabalhadores em tempo real utilizando Visão Computacional de ponta. O sistema detecta inatividade, uso de celular e quedas diretamente no navegador, com integração completa para notificações e registro de incidentes.

## 🚀 Como Instalar e Rodar

1.  **Clone ou baixe** este repositório.
2.  **Instale as dependências** do servidor:
    ```bash
    npm install
    ```
3.  **Configure as variáveis de ambiente**:
    - Copie o arquivo `.env.example` para `.env`.
    - Preencha as credenciais obrigatórias do **Supabase** (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`) e o **JWT_SECRET**.
    - (Opcional) Preencha os dados de Telegram, SMTP ou Webhooks.
4.  **Inicie o servidor**:
    ```bash
    node server.js
    ```
5.  **Acesse no Chrome**: `http://localhost:3000`

---

## 🛠 Configuração de Notificações

### 🤖 Telegram
1. Fale com o [@BotFather](https://t.me/botfather) e crie um novo bot para obter o `TELEGRAM_TOKEN`.
2. Obtenha seu Chat ID enviando uma mensagem para o bot e acessando `https://api.telegram.org/bot<SEU_TOKEN>/getUpdates`.
3. Insira ambos no arquivo `.env`.

### 📧 E-mail (Gmail)
1. Ative a "Verificação em duas etapas" na sua conta Google.
2. Crie uma "Senha de App" (App Password) em Segurança > Senhas de App.
3. Use seu e-mail como `SMTP_USER` e a senha gerada de 16 dígitos como `SMTP_PASS`.

---

## 🖥 Dashboard de Controle
Acesse `http://localhost:3000/dashboard` para visualizar o histórico de alertas, conferir as capturas de tela dos incidentes e exportar relatórios de atividade.

---

## 📋 Módulos de Detecção

- **Idle Detection**: Monitora o score de movimento baseado em landmarks (punhos, cotovelos, ombros e cabeça). O limite de tempo é configurável pelo usuário diretamente no HUD (padrão 15s).
- **Object & Phone Detection**: Utiliza COCO-SSD para identificar todos os objetos na cena, com lógica especializada para detectar uso de celular baseado na proximidade dos punhos e heurísticas posturais.
- **Fall Detection**: Sistema de dois estágios: 'Possível Queda' (detecção inicial de postura horizontal) e 'Queda Confirmada' (após 5 segundos de imobilidade no chão).

---

## 🛡 Solução de Problemas

- **Câmera não abre**: Verifique as permissões de privacidade do Chrome e se nenhuma outra aba está usando a webcam.
- **Detecção lenta**: O sistema utiliza aceleração de hardware via WebGL. Certifique-se de que a aceleração de hardware está ativada nas configurações do Chrome.
- **Erro de Memória**: O sistema rotaciona automaticamente os alertas após 500 entradas para manter a performance do servidor.

---
**SENTINEL — Segurança e Eficiência Potencializadas por IA**
